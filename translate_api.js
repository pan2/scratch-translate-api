import express from 'express';
import bodyParser from 'body-parser';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ローカルの scratchblocks をインポート
import scratchblocksFactory from './lib/scratchblocks/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JSDOM と scratchblocks の初期化 (translate_script.js と同様)
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost', runScripts: "dangerously", resources: "usable"
});
const { window } = dom;
const sb = scratchblocksFactory(window);

const jaJsonPath = path.resolve(__dirname, './lib/scratchblocks/locales/ja.json');
try {
  const jaData = JSON.parse(fs.readFileSync(jaJsonPath, 'utf-8'));
  sb.loadLanguages({ ja: jaData });
} catch (error) {
  console.error('Error loading ja.json:', error);
  // APIサーバー起動時にエラーなら終了させる
  process.exit(1);
}

const dropdownMapPath = path.resolve(__dirname, './dropdown_map.json');
let dropdownMapEnToJa;
let dropdownMapJaToEn = {};
try {
  dropdownMapEnToJa = JSON.parse(fs.readFileSync(dropdownMapPath, 'utf-8'));
  for (const [enKey, jaValue] of Object.entries(dropdownMapEnToJa)) {
    dropdownMapJaToEn[jaValue] = enKey;
  }
} catch (error) {
  console.error('Error loading dropdown_map.json:', error);
  process.exit(1);
}

// 翻訳関数 (translate_script.js から移植・エラーハンドリングをAPI向けに調整)
function translateScratchEnToJaAPI(englishCode, dropdownTranslationsEnToJa) {
  const doc = sb.parse(englishCode, { languages: ['en'] });
  if (!doc) return { error: "Parse failed for English code", translatedCode: englishCode };
  const jaLangObject = sb.allLanguages['ja'];
  if (!jaLangObject || !jaLangObject.commands) return { error: "Japanese language data not loaded", translatedCode: doc.stringify() };
  doc.translate(jaLangObject);
  let japaneseCode = doc.stringify();
  const sortedEnglishValues = Object.keys(dropdownTranslationsEnToJa).sort((a, b) => b.length - a.length);
  for (const englishValue of sortedEnglishValues) {
    const japaneseValue = dropdownTranslationsEnToJa[englishValue];
    const escapedEnglishValue = englishValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexPatternSquare = new RegExp(`(\\[)${escapedEnglishValue}(\\s*v)?(\\])`, 'g');
    const regexPatternRound = new RegExp(`(\\()${escapedEnglishValue}(\\s*v)?(\\))`, 'g');
    japaneseCode = japaneseCode.replace(regexPatternSquare, (match, openBracket, suffix, closeBracket) => `${openBracket}${japaneseValue}${suffix || ''}${closeBracket}`);
    japaneseCode = japaneseCode.replace(regexPatternRound, (match, openBracket, suffix, closeBracket) => `${openBracket}${japaneseValue}${suffix || ''}${closeBracket}`);
  }
  return { translatedCode: japaneseCode };
}

function translateScratchJaToEnAPI(japaneseCode, dropdownTranslationsJaToEn) {
  const doc = sb.parse(japaneseCode, { languages: ['ja', 'en'] });
  if (!doc) return { error: "Parse failed for Japanese code", translatedCode: japaneseCode };
  const enLangObject = sb.allLanguages['en'];
  if (!enLangObject || !enLangObject.commands) return { error: "English language data not loaded", translatedCode: doc.stringify() };
  doc.translate(enLangObject);
  let englishCode = doc.stringify();
  const sortedJapaneseValues = Object.keys(dropdownTranslationsJaToEn).sort((a, b) => b.length - a.length);
  for (const japaneseValue of sortedJapaneseValues) {
    const englishValue = dropdownTranslationsJaToEn[japaneseValue];
    const escapedJapaneseValue = japaneseValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexPatternSquare = new RegExp(`(\\[)${escapedJapaneseValue}(\\s*v)?(\\])`, 'g');
    const regexPatternRound = new RegExp(`(\\()${escapedJapaneseValue}(\\s*v)?(\\))`, 'g');
    englishCode = englishCode.replace(regexPatternSquare, (match, openBracket, suffix, closeBracket) => `${openBracket}${englishValue}${suffix || ''}${closeBracket}`);
    englishCode = englishCode.replace(regexPatternRound, (match, openBracket, suffix, closeBracket) => `${openBracket}${englishValue}${suffix || ''}${closeBracket}`);
  }
  return { translatedCode: englishCode };
}

// Express アプリケーションのセットアップ
const app = express();
const PORT = process.env.PORT || 3000; // Heroku は PORT 環境変数を設定

app.use(bodyParser.json()); // JSONリクエストボディをパース

// ルートパスへの簡単な応答 (ヘルスチェック用など)
app.get('/', (req, res) => {
    res.send('Scratch Translation API is running!');
});

app.post('/translate', (req, res) => {
  const { code, direction } = req.body;

  if (!code || !direction) {
    return res.status(400).json({ error: 'Missing "code" or "direction" in request body.' });
  }

  let result;
  if (direction === 'en-to-ja') {
    console.log(`API: Translating en-to-ja: ${code.substring(0,50)}...`);
    result = translateScratchEnToJaAPI(code, dropdownMapEnToJa);
  } else if (direction === 'ja-to-en') {
    console.log(`API: Translating ja-to-en: ${code.substring(0,50)}...`);
    result = translateScratchJaToEnAPI(code, dropdownMapJaToEn);
  } else {
    return res.status(400).json({ error: 'Invalid "direction". Use "en-to-ja" or "ja-to-en".' });
  }

  if (result.error) {
    console.error(`API Error: ${result.error}`);
    return res.status(500).json(result);
  }
  console.log(`API Success: Translation successful.`);
  return res.status(200).json(result);
});

app.listen(PORT, () => {
  console.log(`Scratch Translation API server listening on port ${PORT}`);
});