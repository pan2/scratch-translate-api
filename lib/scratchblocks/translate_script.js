import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// __dirname に相当するものを ESM で取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. JSDOMでwindowオブジェクトを作成
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
  runScripts: "dangerously",
  resources: "usable"
});
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.Image = dom.window.Image;
global.SVGElement = dom.window.SVGElement;
global.Blob = dom.window.Blob; // exportPNGで必要になる場合がある
global.URL = dom.window.URL;   // exportPNGで必要になる場合がある

// scratchblocks/index.js から init 関数をインポート
// ルートディレクトリの index.js を指す
import scratchblocksFactory from './index.js'; // translate_script.js がルートにある場合
const sb = scratchblocksFactory(global.window);

// 2. 日本語翻訳データのロード (locales/ja.json)
const jaJsonPath = path.resolve(__dirname, './locales/ja.json'); // パスを修正
let jaData;
try {
  jaData = JSON.parse(fs.readFileSync(jaJsonPath, 'utf-8'));
} catch (error) {
  console.error(`Error reading or parsing ja.json from ${jaJsonPath}:`, error);
  process.exit(1);
}
sb.loadLanguages({ ja: jaData });

// 3. ドロップダウン翻訳マップのロード
// dropdown_map.json は translate_script.js と同じ階層にあると仮定
const dropdownMapPath = path.resolve(__dirname, './dropdown_map.json');
let dropdownMap;
try {
  dropdownMap = JSON.parse(fs.readFileSync(dropdownMapPath, 'utf-8'));
} catch (error) {
  console.error(`Error reading or parsing dropdown_map.json from ${dropdownMapPath}:`, error);
  process.exit(1);
}

/**
 * 英語のScratchブロックコードを日本語に翻訳します。
 * ドロップダウンの選択肢も指定されたマップに基づいて翻訳します。
 * @param {string} englishCode 英語のScratchブロックコード
 * @param {object} dropdownTranslations ドロップダウン翻訳マップ
 * @returns {string} 日本語に翻訳されたScratchブロックコード
 */
function translateScratch(englishCode, dropdownTranslations) {
  // 4.1. パース
  const doc = sb.parse(englishCode, { languages: ['en'] });

  // 4.2. ブロックテキストの翻訳
  doc.translate('ja');

  // 4.3. 文字列化
  let japaneseCode = doc.stringify();

  // 4.4. ドロップダウンの翻訳 (stringify後の文字列置換)
  const sortedEnglishValues = Object.keys(dropdownTranslations).sort((a, b) => b.length - a.length);

  for (const englishValue of sortedEnglishValues) {
    const japaneseValue = dropdownTranslations[englishValue];
    const escapedEnglishValue = englishValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // "[value v]" or "(value v)" or "[value]" or "(value)"
    // Scratch 3.0のドロップダウンは ' v' を持たないものが多いため、パターンを拡張
    const regexPatternSquare = new RegExp(`(\\[)${escapedEnglishValue}(\\s*v)?(\\])`, 'g');
    const regexPatternRound = new RegExp(`(\\()${escapedEnglishValue}(\\s*v)?(\\))`, 'g');

    japaneseCode = japaneseCode.replace(regexPatternSquare, (match, openBracket, suffix, closeBracket) => {
        return `${openBracket}${japaneseValue}${suffix || ''}${closeBracket}`;
    });
    japaneseCode = japaneseCode.replace(regexPatternRound, (match, openBracket, suffix, closeBracket) => {
        return `${openBracket}${japaneseValue}${suffix || ''}${closeBracket}`;
    });
  }
  return japaneseCode;
}

// --- 翻訳の実行例 ---
const sampleEnglishCode = `
when @greenFlag clicked
move (10) steps
turn @turnRight (15) degrees
say [Hello!] for (2) secs
go to [random position v]
if <touching [mouse-pointer v]?> then
  set [my variable v] to [world]
end
set rotation style [left-right v]
switch costume to [costume1 v]
switch backdrop to [backdrop1 v]
play sound [Meow v] until done
`;

const translatedCode = translateScratch(sampleEnglishCode, dropdownMap);
console.log("--- English Code ---");
console.log(sampleEnglishCode);
console.log("\n--- Japanese Code (Translated) ---");
console.log(translatedCode);

// ファイルへの書き出し例
const outputPath = path.resolve(__dirname, './translated_code_output.txt');
fs.writeFileSync(outputPath, translatedCode, 'utf-8');
console.log(`\nTranslated code saved to ${outputPath}`);

// もう一つの例：ドロップダウンに 'v' がない場合
const sampleEnglishCode2 = `
point in direction (90)
set [size v] to (100)
change [color v] effect by (25)
`;

const translatedCode2 = translateScratch(sampleEnglishCode2, dropdownMap);
console.log("\n--- English Code 2 ---");
console.log(sampleEnglishCode2);
console.log("\n--- Japanese Code 2 (Translated) ---");
console.log(translatedCode2);

const sampleEnglishCode3 = `
when backdrop switches to [backdrop1 v]
next backdrop
`;
const translatedCode3 = translateScratch(sampleEnglishCode3, dropdownMap);
console.log("\n--- English Code 3 ---");
console.log(sampleEnglishCode3);
console.log("\n--- Japanese Code 3 (Translated) ---");
console.log(translatedCode3);