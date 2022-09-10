const ENV = require('./ENV');
const pngjs = require('pngjs');
const _ = require('lodash');
const fs = require('fs');

async function runQuery(query) {
    const res = await fetch(ENV.url, {
        headers: {
            'accept': '*/*',
            'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            'authorization': ENV.authorization,
            'content-type': 'application/json',
            'sec-ch-ua': '".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Linux"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
        },
        referrerPolicy: 'strict-origin-when-cross-origin',
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        body: JSON.stringify({ query }),
    });
    const { data, errors } = await res.json();
    if (errors) {
        console.debug('errors', errors.map(({ message }) => message));
        process.exit();
    }
    return { data };
}

const sleep = time => new Promise(resolve => setTimeout(resolve, time));

const pixelVar = pixel => JSON.stringify(pixel).replace(/"/g, '');

function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
}

function rgbToHex(r, g, b) {
    return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

const hexToRgb = _.memoize(hex => {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
    } : null;
});

const distance = (a, b) => Math.sqrt(Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2));

function nearestColor(colors, { r, g, b }) {
    var lowest = Number.POSITIVE_INFINITY;
    var tmp;
    let index = 0;
    colors.forEach(({ colorCode }, i) => {
        tmp = distance(hexToRgb(colorCode), { r, g, b });
        if (tmp < lowest) {
            lowest = tmp;
            index = i;
        }
    });
    return index;
}

async function loadColors() {
    const { data: { getAvailableColors: colors } } = await runQuery(
        `query getAvailableColors { getAvailableColors { name colorCode }}`
    );
    return colors;
}

async function loadCachedColors() {
    const cacheFile = 'colors.json';
    const cacheExists = await fs.promises.stat(cacheFile).then(() => true).catch(() => false);
    if (cacheExists) {
        return JSON.parse(await fs.promises.readFile(cacheFile));
    } else {
        const colors = await loadColors();
        await fs.promises.writeFile(cacheFile, JSON.stringify(colors, null, 2));
        return colors;
    }
}

function loadPNGStream({ colors, stream, transparentColor, outputStream, init = 0, step=1 }) {
    return new Promise((resolve) => {
        stream.pipe(new pngjs.PNG())
            .on('parsed', function () {
                const pixels = [];
                let y1 = 0;
                for (let y = init; y < this.height; y += step) {
                    y1 += 1;
                    let x1 = 0;
                    for (let x = init; x < this.width; x += step) {
                        x1 += 1;
                        const idx = (this.width * y + x) << 2;
                        const rgb = { r: this.data[idx], g: this.data[idx + 1], b: this.data[idx + 2] };
                        const opacity = this.data[idx + 3];
                        const color = nearestColor(colors, rgb);
                        if (color !== transparentColor && opacity !== 0) {
                            pixels.push({ x: x1, y: y1, color });
                        }
                    }
                }
                resolve(pixels);
                if (outputStream) this.pack().pipe(outputStream);
            });
    });
}

// Index pixels by x/y pos
function indexPixelPos(image) {
    const index = {};
    for (let pixel of image) {
        const { x, y } = pixel;
        _.setWith(index, [x, y], pixel, Object);
    }
    return index;
}

function toPNG({ pixels, colors, file }) {
    const png = new pngjs.PNG({ width: 700, height: 500, filterType: -1 });
    for (let { x, y, color } of pixels) {
        let { colorCode } = colors[color];
        const { r, g, b } = hexToRgb(colorCode);
        var idx = (png.width * y + x) << 2;
        png.data[idx] = r; // red
        png.data[idx + 1] = g; // green
        png.data[idx + 2] = b; // blue
        png.data[idx + 3] = 255; // alpha (0 is transparent)
    }
    png.pack().pipe(fs.createWriteStream(file));
}

module.exports = {
    runQuery,
    sleep,
    pixelVar,
    loadPNGStream,
    loadCachedColors,
    indexPixelPos,
    hexToRgb,
    toPNG
};
