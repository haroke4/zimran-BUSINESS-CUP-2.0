"""Render the finished soft UI tap; no synthesizer is shipped to the player."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 24000
length = int(rate * 0.045)
rng = random.Random(7143)
low = 0.0
slow = 0.0
samples = []
for index in range(length):
    t = index / rate
    low += (1 - math.exp(-2 * math.pi * 1000 / rate)) * (rng.uniform(-1, 1) - low)
    slow += (1 - math.exp(-2 * math.pi * 180 / rate)) * (low - slow)
    envelope = min(1.0, t / 0.004) * math.exp(-t / 0.012) * min(1.0, (0.045 - t) / 0.008)
    tone = math.sin(2 * math.pi * (420 * t - 750 * t * t))
    samples.append(envelope * ((low - slow) * 0.7 + tone * 0.22))
peak = max(abs(value) for value in samples)
samples = [value / peak * 0.1 for value in samples]
output = Path(__file__).resolve().parents[1] / 'src/static/audio/text-tap-v1.wav'
with wave.open(str(output), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(rate)
    audio.writeframes(b''.join(struct.pack('<h', round(value * 32767)) for value in samples))
print(f'{output.name}: 45ms, peak -20dBFS before player attenuation')
