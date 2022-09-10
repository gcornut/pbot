const _ = require('lodash');
const fs = require('fs');
const got = require('got');
const { pixelVar, runQuery, sleep, loadPNGStream, loadCachedColors, indexPixelPos } = require('./utils');

async function main() {
    const colors = await loadCachedColors();

    const loadTarget = async ({ originPoint, file, transparentColor }) => {
        const pixels = await loadPNGStream({ colors, stream: fs.createReadStream(file), transparentColor });
        return pixels
            .map(({ x, y, color }) => ({ x: originPoint.x + x, y: originPoint.y + y, color }))
            // Randomize pixels
            .sort(() => 0.5 - Math.random());
    };
    // TARGET image with origin point
    // https://www.pixilart.com/draw?ref=home-page
    const image = await loadTarget({
        originPoint: { x: 174, y: 455 },
        file: 'unknown.png'
    });

    async function loadMap() {
        const { data: { lastBoardUrl } } = await runQuery({
            operationName: 'lastBoardUrl',
            query: 'query lastBoardUrl { lastBoardUrl }',
        });
        console.debug('lastBoardUrl', lastBoardUrl);
        const stream = got.stream(lastBoardUrl);
        const outputStream = fs.createWriteStream('map.png');
        return loadPNGStream({ colors, stream, outputStream });
    }
    // MAP
    const mapPixelIndex = indexPixelPos(await loadMap());


    async function protec({ maxCredit = 100, minLevel = 2 }) {
        const correctPixels = image
            // Keep pixels with incorrect color
            .filter(({ x, y, color }) => mapPixelIndex[x]?.[y] && mapPixelIndex[x][y].color === color);

        console.debug(`Total pixels to protect:`, correctPixels.length);

        const getPixels = {
            query: `query getPixelLevel { ${correctPixels.map(
                ({ x, y }, i) => `a${i}: getPixelLevel(pixel: ${pixelVar({ x, y })}) { x y level }`,
            ).join('\n')} }`,
        };
        const { data } = await runQuery(getPixels);
        let cost = 0;
        const pixels = [];
        for (let [sIdx, { x, y, level }] of Object.entries(data)) {
            let targetLevel = level + 1;
            if (level < minLevel && cost < maxCredit) {
                cost += targetLevel;
                pixels.push({ x, y, targetLevel });
            }
        }
        console.debug(`Pixels to protect (minLevel: ${minLevel}):`, pixels.length, `(cost: ${cost})`);
        console.debug('Cost:', cost);

        for (let pixelBatch of _.chunk(pixels, 3)) {
            const upgradePixels = {
                query: `mutation upgradePixels { ${pixelBatch.map(
                    (pixel, i) => `a${i}: upgradePixels(pixels: [${pixelVar(pixel)}])`,
                ).join('\n')} }`,
            };
            await sleep(1000 + (Math.random() * 500));
            console.debug('mutate ', JSON.stringify(pixelBatch));
            const { errors } = await runQuery(upgradePixels);
            if (errors) {
                console.debug(JSON.stringify(errors, null, 2));
                process.exit();
            }
        }
    }

    async function atac({ maxCredit = 100, maxLevel = 4, upgrade = true }) {
        const incorrectPixels = image
            // Keep pixels with incorrect color
            .filter(({ x, y, color }) => mapPixelIndex[x]?.[y] && mapPixelIndex[x][y].color !== color);

        console.debug(`Total pixels to fix:`, incorrectPixels.length);
        if (incorrectPixels.length === 0) return;

        const getPixels = {
            query: `query getPixelLevel { ${incorrectPixels.map(
                ({ x, y }, i) => `a${i}: getPixelLevel(pixel: ${pixelVar({ x, y })}) { x y level }`,
            ).join('\n')}  }`,
        };
        const { data } = await runQuery(getPixels);
        let cost = 0;
        const pixels = [];
        for (let [sIdx, { x, y, level }] of Object.entries(data)) {
            const idx = parseInt(sIdx.split('a')[1]);
            const { color } = incorrectPixels[idx];

            if (cost < maxCredit && level < maxLevel) {
                cost += level;
                if (upgrade) cost += level + 1;
                pixels.push({ x, y, color, currentLevel: level });
            }
        }
        console.debug(`Pixel to fix (maxLevel: ${maxLevel}):`, pixels.length, `(cost: ${cost})\n`);

        for (let pixelBatch of _.chunk(pixels, 3)) {
            const pixelSets = pixelBatch.map(({ x, y, color, currentLevel }, i) => `
                a${i}: setPixels(pixels: [${pixelVar({ x, y, color, currentLevel })}])
                ${upgrade ? `b${i}: upgradePixels(pixels: [${pixelVar({ x, y, targetLevel: currentLevel + 1 })}])` : ''}
            `).join('\n');
            let setPixels = {
                operationName: 'setPixels',
                variables: { pixels: [{ x: 193, y: 489, color: 1, currentLevel: 1 }] },
                query: `mutation setPixels { ${pixelSets} }`,
            };
            await sleep(1000 + (Math.random() * 500));
            console.debug('mutate ', JSON.stringify(pixelBatch));
            const { errors } = await runQuery(setPixels);
            if (errors) {
                console.debug(JSON.stringify(errors, null, 2));
                process.exit();
            }
        }
    }

    //await atac({ maxCredit: 48 });
    //await protec({ maxCredit: 10 });
}

main();
