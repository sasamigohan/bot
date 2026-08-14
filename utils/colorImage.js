'use strict';

/**
 * ラッキーカラー確認用の画像（PNG）生成
 *
 * canvas / sharp などのネイティブ依存を足さずに済むよう、
 * Node標準の zlib だけで PNG を直接組み立てる。
 * 単色の塗りつぶしとグラデーションしか描かないため、これで十分。
 */

const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32（PNGの各チャンクに必要）
const CRC_TABLE = (() => {
    const table = new Int32Array(256);

    for (let n = 0; n < 256; n++) {
        let c = n;

        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }

        table[n] = c;
    }

    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;

    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }

    return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);

    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);

    return Buffer.concat([length, typeAndData, crc]);
}

/**
 * RGBのピクセルバッファ（width*height*3）からPNGを作る
 */
function encodePng(width, height, rgb) {
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 2;  // color type: truecolor (RGB)
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace

    // 各行の先頭にフィルタタイプ(0 = None)を挟む必要がある
    const raw = Buffer.alloc(height * (1 + width * 3));

    for (let y = 0; y < height; y++) {
        const rowStart = y * (1 + width * 3);
        raw[rowStart] = 0;
        rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
    }

    return Buffer.concat([
        PNG_SIGNATURE,
        createChunk('IHDR', ihdrData),
        createChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        createChunk('IEND', Buffer.alloc(0))
    ]);
}

/**
 * "#RRGGBB" / "RRGGBB" を {r, g, b} に変換する。
 * 解釈できない場合は null。
 */
function parseHex(hex) {
    if (typeof hex !== 'string') return null;

    const value = hex.replace('#', '').trim();

    if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;

    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
    };
}

function normalizeHex(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return null;

    return (
        '#' +
        [rgb.r, rgb.g, rgb.b]
            .map(v => v.toString(16).padStart(2, '0'))
            .join('')
            .toUpperCase()
    );
}

function mix(from, to, t) {
    return {
        r: Math.round(from.r + (to.r - from.r) * t),
        g: Math.round(from.g + (to.g - from.g) * t),
        b: Math.round(from.b + (to.b - from.b) * t)
    };
}

/**
 * 明るい色は暗い枠線、暗い色は明るい枠線を使って、
 * 背景に溶けないようにする
 */
function relativeLuminance({ r, g, b }) {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * グラデーション（または単色）のプレビュー画像を作る。
 *
 * secondaryHex がある場合は
 *   上段: 左から右へのグラデーション帯
 *   下段: 開始色 / 終了色 の単色パネル2枚
 * という構成にして、混ざり具合と元の2色の両方が分かるようにする。
 *
 * @returns {{buffer: Buffer, width: number, height: number}|null}
 */
function createColorPreviewImage(primaryHex, secondaryHex = null) {
    const from = parseHex(primaryHex);
    if (!from) return null;

    const to = secondaryHex ? parseHex(secondaryHex) : null;

    const width = 800;
    const gradientHeight = to ? 200 : 300;
    const swatchHeight = to ? 100 : 0;
    const gap = to ? 8 : 0;
    const height = gradientHeight + gap + swatchHeight;

    const rgb = Buffer.alloc(width * height * 3);

    const setPixel = (x, y, color) => {
        const offset = (y * width + x) * 3;
        rgb[offset] = color.r;
        rgb[offset + 1] = color.g;
        rgb[offset + 2] = color.b;
    };

    // 上段：グラデーション帯（単色の場合はベタ塗り）
    for (let x = 0; x < width; x++) {
        const color = to ? mix(from, to, width === 1 ? 0 : x / (width - 1)) : from;

        for (let y = 0; y < gradientHeight; y++) {
            setPixel(x, y, color);
        }
    }

    if (to) {
        // 区切りの隙間（白）。境目をはっきりさせる
        for (let y = gradientHeight; y < gradientHeight + gap; y++) {
            for (let x = 0; x < width; x++) {
                setPixel(x, y, { r: 255, g: 255, b: 255 });
            }
        }

        // 下段：開始色と終了色を左右に並べる
        const half = Math.floor(width / 2);

        for (let y = gradientHeight + gap; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (x === half - Math.floor(gap / 2) || x === half + Math.floor(gap / 2)) {
                    setPixel(x, y, { r: 255, g: 255, b: 255 });
                    continue;
                }

                setPixel(x, y, x < half ? from : to);
            }
        }
    }

    return { buffer: encodePng(width, height, rgb), width, height };
}

module.exports = {
    createColorPreviewImage,
    parseHex,
    normalizeHex,
    relativeLuminance
};
