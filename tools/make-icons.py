#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Remiku — pembuat ikon PWA (icon-192.png & icon-512.png).

Kenapa skrip ini ada?
  Ikon harus berupa PNG yang VALID (bukan file placeholder kosong), tetapi
  proyek ini sengaja tidak memakai dependency apa pun. Skrip ini hanya memakai
  modul standar Python (zlib + struct) sehingga PNG dapat dibuat tanpa Pillow.

Cara pakai:
  python3 tools/make-icons.py

Desain: neo-brutalism — kartu putih ber-border hitam tebal di atas latar pink,
dengan simbol hati kartu Remi. Seluruh konten utama berada dalam "safe zone"
80% sehingga aman dipakai juga sebagai ikon maskable (Android adaptive icon).
"""

import os
import struct
import zlib

# ---------------------------------- WARNA ---------------------------------- #
BG = (255, 77, 157)     # pink brand (#FF4D9D)
CARD = (255, 255, 255)  # putih kartu
INK = (17, 17, 17)      # hitam neo-brutalism

# -------------------------------- GEOMETRI --------------------------------- #
# Semua koordinat dinyatakan dalam "unit desain" 512x512, lalu diskalakan
# sehingga ikon 192px dan 512px dihasilkan dari bentuk yang identik.
OUTER = (112.0, 112.0, 400.0, 400.0)  # kartu luar (hitam) -> aman untuk maskable
INNER = (130.0, 130.0, 382.0, 382.0)  # bagian dalam (putih)
OUTER_R = 48.0
INNER_R = 30.0
SHADOW_DX = 14.0                      # offset bayangan hitam (efek "offset print")
HEART_CX = 256.0
HEART_CY = 262.0
HEART_R = 80.0
HEART_OUTLINE = 1.16                  # faktor pembesaran untuk garis tepi hati


def rounded_rect(x, y, box, radius):
    """True bila titik (x, y) berada di dalam rounded-rectangle `box`."""
    x0, y0, x1, y1 = box
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    if x < x0 + radius and y < y0 + radius:
        dx, dy = x - (x0 + radius), y - (y0 + radius)
        return dx * dx + dy * dy <= radius * radius
    if x > x1 - radius and y < y0 + radius:
        dx, dy = x - (x1 - radius), y - (y0 + radius)
        return dx * dx + dy * dy <= radius * radius
    if x < x0 + radius and y > y1 - radius:
        dx, dy = x - (x0 + radius), y - (y1 - radius)
        return dx * dx + dy * dy <= radius * radius
    if x > x1 - radius and y > y1 - radius:
        dx, dy = x - (x1 - radius), y - (y1 - radius)
        return dx * dx + dy * dy <= radius * radius
    return True


def heart(x, y, grow):
    """
    Kurva hati kartu Remi: (u^2 + v^2 - 1)^3 - u^2 * v^3 <= 0.
    `grow` > 1 memperbesar bentuk (dipakai untuk garis tepi hati).
    """
    scale = HEART_R * grow
    u = (x - HEART_CX) / scale
    v = (HEART_CY - y) / scale
    a = u * u + v * v - 1.0
    return a * a * a - u * u * v * v * v <= 0.0


def sample(x, y):
    """Warna pada satu titik (koordinat unit desain)."""
    if rounded_rect(x, y, INNER, INNER_R):
        if heart(x, y, 1.0):
            return BG          # hati pink
        if heart(x, y, HEART_OUTLINE):
            return INK         # garis tepi hati
        return CARD
    if rounded_rect(x, y, OUTER, OUTER_R):
        return INK             # border tebal kartu
    if rounded_rect(x - SHADOW_DX, y - SHADOW_DX, OUTER, OUTER_R):
        return INK             # bayangan offset
    return BG


def render(size, samples=4):
    """
    Merender ikon `size` x `size` dengan supersampling `samples` x `samples`
    per piksel (anti-aliasing), mengembalikan list baris RGB bytearray.
    """
    design = 512.0
    step = design / (size * samples)
    offset = step / 2.0

    rows = []
    for py in range(size):
        row = bytearray(size * 3)
        idx = 0
        for px in range(size):
            r = g = b = 0
            for sy in range(samples):
                y = (py * samples + sy) * step + offset
                for sx in range(samples):
                    x = (px * samples + sx) * step + offset
                    c = sample(x, y)
                    r += c[0]
                    g += c[1]
                    b += c[2]
            total = samples * samples
            row[idx] = r // total
            row[idx + 1] = g // total
            row[idx + 2] = b // total
            idx += 3
        rows.append(row)
    return rows


def write_png(path, size, rows):
    """Menulis file PNG truecolor 8-bit (color type 2) tanpa dependency."""
    raw = bytearray()
    for row in rows:
        raw.append(0)          # filter type 0 (None)
        raw.extend(row)

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', header)
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')

    with open(path, 'wb') as handle:
        handle.write(png)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icons_dir = os.path.join(root, 'icons')
    if not os.path.isdir(icons_dir):
        os.makedirs(icons_dir)

    for size in (192, 512):
        path = os.path.join(icons_dir, 'icon-%d.png' % size)
        write_png(path, size, render(size))
        print('dibuat: %s (%d byte)' % (path, os.path.getsize(path)))


if __name__ == '__main__':
    main()
