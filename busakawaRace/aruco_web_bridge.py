#!/usr/bin/env python3
"""Read-only reuse of check.py's detector; stream marker geometry to the Web app."""
import argparse
import asyncio
import importlib.util
import json
import math
from pathlib import Path
import sys
import time

DEFAULT_CHECK_PATH = Path(
    '/Users/sasakiyuri/Desktop/院研究/ぶさかわレースハード用/2026-09-15/'
    'unity-unity-4-web-x-y/outputs/aruco-check/check.py'
)


def load_check(path):
    path = path.expanduser().resolve()
    if not path.is_file():
        raise ValueError(f'check.pyが見つからないよ: {path}\n--check-path で保存先を指定してね。')
    spec = importlib.util.spec_from_file_location('busakawa_aruco_check', path)
    module = importlib.util.module_from_spec(spec)
    # 元のフォルダへ__pycache__も作らず、check.pyのmainも実行しない。
    exec(compile(path.read_text(encoding='utf-8-sig'), str(path), 'exec'), module.__dict__)
    return module


def make_packet(results, sequence):
    markers = []
    for marker_id, result in results.items():
        marker = {'target_id': int(marker_id), 'detected': False,
                  'status': result.get('status', 'not_detected')}
        if result.get('detected'):
            values = [result.get(key) for key in ('x_norm', 'y_norm', 'rotation_ccw_deg')]
            if all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
                x, y, rotation = values
                if 0 <= x <= 1 and 0 <= y <= 1:
                    marker.update(detected=True, status='detected', x_norm=x,
                                  y_norm=y, rotation_ccw_deg=rotation)
        markers.append(marker)
    return json.dumps({'type': 'aruco_frame', 'sequence': sequence,
                       'timestamp': time.time(), 'markers': markers}, allow_nan=False)


def parse_args():
    parser = argparse.ArgumentParser(description='ArUcoの座標と回転をWebSocketでThree.jsへ送る')
    parser.add_argument('--check-path', type=Path, default=DEFAULT_CHECK_PATH,
                        help='既存check.pyの保存先（変更せず検出関数だけ読み込む）')
    parser.add_argument('--family', default='DICT_4X4_50')
    parser.add_argument('--ids', default='0,1,2', help='検出対象ID。Web側の対応設定と揃える')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--fps', type=float, default=15, help='送信の上限Hz（既定15）')
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--camera', type=int, default=0)
    source.add_argument('--file', type=Path, help='カメラの代わりに画像または動画を使う')
    parser.add_argument('--no-preview', action='store_true')
    parser.add_argument('--duration', type=float, default=0, help='指定秒数で終了。0は終了操作まで')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535 or not math.isfinite(args.fps) or not 1 <= args.fps <= 60:
        parser.error('ポートは1024〜65535、fpsは1〜60にしてね。')
    if args.camera < 0 or not math.isfinite(args.duration) or args.duration < 0:
        parser.error('カメラ番号とdurationは0以上にしてね。')
    return args


async def run(args):
    try:
        from websockets.asyncio.server import serve
        from websockets.exceptions import ConnectionClosed
    except ImportError as error:
        raise RuntimeError('websocketsが必要だよ。python3 -m pip install "websockets>=14,<16"') from error
    check = load_check(args.check_path)
    cv2 = check.cv2
    ids = check.parse_ids(args.ids)
    detector, count = check.make_detector(args.family)
    if any(n >= count for n in ids):
        raise ValueError(f'{args.family}のIDは0〜{count - 1}だよ。')
    still = None
    cap = None
    clients = set()
    latest = None
    window = 'ArUco Web Bridge (Q / Esc: quit)'

    async def handle_client(socket):
        # 遅い受信者には未送信の最新1件だけを残す。
        queue = asyncio.Queue(maxsize=1)
        clients.add(queue)
        print(f'Web接続: {len(clients)}クライアント', flush=True)
        if latest is not None:
            queue.put_nowait(latest)
        async def send_latest():
            while True:
                await socket.send(await queue.get())
        sender = asyncio.create_task(send_latest())
        closed = asyncio.create_task(socket.wait_closed())
        try:
            done, _ = await asyncio.wait((sender, closed), return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except ConnectionClosed:
            pass
        finally:
            clients.discard(queue)
            sender.cancel()
            closed.cancel()
            await asyncio.gather(sender, closed, return_exceptions=True)
            print(f'Web切断: {len(clients)}クライアント', flush=True)

    try:
        if args.file:
            if not args.file.is_file():
                raise ValueError(f'映像ファイルが見つからないよ: {args.file}')
            still = cv2.imread(str(args.file))
            if still is None:
                cap = cv2.VideoCapture(str(args.file))
        else:
            backend = cv2.CAP_AVFOUNDATION if sys.platform == 'darwin' else cv2.CAP_ANY
            cap = cv2.VideoCapture(args.camera, backend)
        if cap is not None and not cap.isOpened():
            raise RuntimeError('カメラを開けないよ。カメラの許可と--cameraの番号を確認してね。')
        print(f'WebSocket: ws://127.0.0.1:{args.port}\n対象: {args.family} / ID {ids} / 上限{args.fps:g}Hz', flush=True)
        # ローカル専用。映像自体は送らず、ID・座標・角度だけ送信する。
        async with serve(handle_client, '127.0.0.1', args.port,
                         ping_interval=10, ping_timeout=10, close_timeout=2, max_size=4096):
            start = time.monotonic()
            logged = start - 1
            sequence = 0
            while not args.duration or time.monotonic() - start < args.duration:
                tick = time.monotonic()
                if still is not None:
                    frame = still.copy()
                else:
                    ok, frame = await asyncio.to_thread(cap.read)
                    if not ok:
                        if args.file:
                            break
                        raise RuntimeError('カメラ映像が途切れたよ。接続を確認してね。')
                results, corners, marker_ids, _ = await asyncio.to_thread(check.measure_many, frame, detector, ids)
                sequence += 1
                latest = make_packet(results, sequence)
                for queue in tuple(clients):
                    if queue.full():
                        queue.get_nowait()
                    queue.put_nowait(latest)
                if tick - logged >= 1:
                    visible = [n for n, r in results.items() if r['detected']]
                    print(f'frame={sequence} 検出ID={visible} Web接続={len(clients)}', flush=True)
                    logged = tick
                if not args.no_preview:
                    if marker_ids is not None:
                        cv2.aruco.drawDetectedMarkers(frame, corners, marker_ids)
                    cv2.imshow(window, frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord('q'), 27) or cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1:
                        break
                await asyncio.sleep(max(0, 1 / args.fps - (time.monotonic() - tick)))
    finally:
        if cap is not None:
            cap.release()
        if not args.no_preview:
            cv2.destroyAllWindows()


def main():
    try:
        asyncio.run(run(parse_args()))
    except KeyboardInterrupt:
        print('終了したよ。')
    except Exception as error:
        print(f'エラー: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
