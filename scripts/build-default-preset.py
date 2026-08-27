#!/usr/bin/env python3
"""현재 store.json에서 첫 실행 기본 프리셋 JSON을 생성한다.

사용:
  python3 scripts/build-default-preset.py "<store.json 경로>" [모드 ...]

기기 종속 값(id, count, 사운드 경로)은 비우고 이미지 파일은 data URL로 박아 넣는다.
첫 실행 마이그레이션이 data URL을 appData/images 파일로 풀어 준다.
"""
import base64
import json
import mimetypes
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODES = ['4key', '5key', '6key', '8key']
DROP_FIELDS = {'id', 'soundPath'}


def round_num(value):
    if isinstance(value, float):
        rounded = round(value, 2)
        return int(rounded) if rounded == int(rounded) else rounded
    if isinstance(value, dict):
        return {k: round_num(v) for k, v in value.items()}
    if isinstance(value, list):
        return [round_num(v) for v in value]
    return value


def image_to_data_url(path):
    if not path:
        return ''
    if path.startswith('data:'):
        return path
    mime = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    if path.endswith('.svg'):
        mime = 'image/svg+xml'
    with open(path, 'rb') as handle:
        payload = base64.b64encode(handle.read()).decode('ascii')
    return f'data:{mime};base64,{payload}'


def clean_position(position):
    out = {}
    for key, value in position.items():
        if key in DROP_FIELDS:
            continue
        if key == 'count':
            out[key] = 0
            continue
        if key in ('inactiveImage', 'activeImage'):
            out[key] = image_to_data_url(value)
            continue
        if key == 'soundEnabled' or value is None:
            continue
        out[key] = round_num(value)
    return out


def clean_stat(stat):
    out = {}
    for key, value in stat.items():
        if key == 'position':
            out[key] = clean_position(value)
        elif key == 'id' or value is None:
            continue
        else:
            out[key] = round_num(value)
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    store = json.load(open(sys.argv[1]))
    modes = sys.argv[2:] or MODES

    keys = {mode: store['keys'][mode] for mode in modes}
    positions = {
        mode: [clean_position(p) for p in store['keyPositions'][mode]]
        for mode in modes
    }
    stats = {
        mode: [clean_stat(s) for s in store.get('statPositions', {}).get(mode, [])]
        for mode in modes
    }
    for mode in modes:
        assert len(keys[mode]) == len(positions[mode]), mode

    def dump(name, data):
        path = os.path.join(ROOT, 'src-tauri', name)
        with open(path, 'w') as handle:
            json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
            handle.write('\n')
        print(f'{name}: {os.path.getsize(path)}B')

    dump('default_keys.json', keys)
    dump('default_positions.json', positions)
    dump('default_stat_positions.json', stats)


if __name__ == '__main__':
    main()
