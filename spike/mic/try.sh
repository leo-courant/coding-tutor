#!/bin/sh
# SPIKE - throwaway. Talk into your mic and see what local speech recognition hears.
# Usage: spike/mic/try.sh           (default mic, your Bluetooth headset)
#        spike/mic/try.sh laptop    (the built-in laptop mic)
if [ -n "$FLATPAK_ID" ]; then exec flatpak-spawn --host "$(realpath "$0")" "$@"; fi
cd "$(dirname "$(realpath "$0")")/../.." || exit 1
exec uv run --quiet --python 3.12 --with faster-whisper --with soundfile \
  --with nvidia-cublas-cu12 --with 'nvidia-cudnn-cu12==9.*' python spike/mic/try.py "$@"
