import express from 'express';
import bodyParser from 'body-parser';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import scratchblocksFactory from './lib/scratchblocks/index.js'; // ローカルの scratchblocks

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// JSDOM と scratchblocks の初期化
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost', runScripts: "dangerously", resources: "usable"
});
const { window } = dom;
const sb = scratchblocksFactory(window);

// custom_ja.json のロード
let customJaData;
let mapJaValueToEnKey = {}; // 日本語ドロップダウン値 -> 英語キー
let mapEnKeyToJaValue = {}; // 英語ドロップダウンキー -> 日本語値 (en-to-ja用)

const customJaPath = path.resolve(__dirname, './custom_ja.json'); // ★★★ custom_ja.json の実際のパスに書き換えてください
try {
  const rawJsonData = fs.readFileSync(customJaPath, 'utf-8');
  customJaData = JSON.parse(rawJsonData);
  sb.loadLanguages({ ja: customJaData });

  if (customJaData && customJaData.dropdowns) {
    mapEnKeyToJaValue = customJaData.dropdowns; // en-to-ja 用
    for (const [enKey, jaValue] of Object.entries(customJaData.dropdowns)) {
      mapJaValueToEnKey[jaValue] = enKey; // ja-to-en 用
    }
  } else {
    console.warn('custom_ja.json does not contain a "dropdowns" section. Dropdown translations may be incomplete.');
  }
} catch (error) {
  console.error(`Error loading or processing custom_ja.json from ${customJaPath}:`, error);
  process.exit(1);
}


// ASTを走査してドロップダウンの値を翻訳するヘルパー関数
function traverseAndTranslateDropdowns(node, translationMap, direction) {
  if (!node || !translationMap) return;

  if (node.isBlock) {
    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(child => {
        // ドロップダウンInputかどうかを判定 (shape や hasArrow で判断)
        // sb.Input.prototype.hasArrow は v3.x では存在しないかもしれないので shape で判断するのがより確実
        const isDropdownInput = child && child.isInput &&
                               (child.shape === 'dropdown' || child.shape === 'number-dropdown' || child.hasArrow); // hasArrowも念のため

        if (isDropdownInput) {
          // menu プロパティにパース時の元の値が入っていることを期待
          // value プロパティは翻訳によって書き換わる可能性がある
          let originalValue = child.menu || (child.value !== null && child.value !== undefined ? String(child.value) : '');

          if (direction === 'ja-to-en') { // 日本語 -> 英語
            if (typeof originalValue === 'string' && Object.prototype.hasOwnProperty.call(translationMap, originalValue)) {
              const translatedKey = translationMap[originalValue];
              child.value = translatedKey;
              if (child.label && typeof child.label === 'object' && child.label !== null && Object.prototype.hasOwnProperty.call(child.label, 'value')) {
                child.label.value = translatedKey;
              }
              // child.menu も英語キーに戻すか検討 (stringify時に影響するか確認)
              // child.menu = translatedKey;
            }
          } else if (direction === 'en-to-ja') { // 英語 -> 日本語
             if (typeof originalValue === 'string' && Object.prototype.hasOwnProperty.call(translationMap, originalValue)) {
              const translatedDisplayValue = translationMap[originalValue];
              child.value = translatedDisplayValue;
              if (child.label && typeof child.label === 'object' && child.label !== null && Object.prototype.hasOwnProperty.call(child.label, 'value')) {
                child.label.value = translatedDisplayValue;
              }
            }
          }
        } else {
          traverseAndTranslateDropdowns(child, translationMap, direction); // 子ノードも再帰的に処理
        }
      });
    }
  } else if (node.isScript) {
    if (node.blocks && Array.isArray(node.blocks)) {
      node.blocks.forEach(block => traverseAndTranslateDropdowns(block, translationMap, direction));
    }
  } else if (node.scripts && Array.isArray(node.scripts)) { // Documentの場合
      node.scripts.forEach(script => traverseAndTranslateDropdowns(script, translationMap, direction));
  }
}

// 日本語コードを英語コードに翻訳するAPI向け関数
function translateScratchJaToEnAPI(japaneseCode, dropdownTranslationsJaToEn) {
  // パース時に ja と en を指定することで、日本語の構造を理解しつつ、
  // 内部的には英語のブロックIDやspecにマッピングしようとする
  const doc = sb.parse(japaneseCode, { languages: ['ja', 'en'] });
  if (!doc) return { error: "Parse failed for Japanese code", translatedCode: japaneseCode };

  const enLangObject = sb.allLanguages['en'];
  if (!enLangObject || !enLangObject.commands) return { error: "English language data not loaded", translatedCode: doc.stringify() };

  // 1. ブロック全体の構造とテキスト (引数以外) を英語に変換
  doc.translate(enLangObject);

  // 2. ASTを走査し、ドロップダウンの値を日本語から英語キーに変換
  traverseAndTranslateDropdowns(doc, dropdownTranslationsJaToEn, 'ja-to-en');

  // 3. 翻訳・編集済みのASTから英語コードを生成
  const englishCode = doc.stringify();

  return { translatedCode: englishCode };
}

// 英語コードを日本語コードに翻訳するAPI向け関数 (もし必要なら)
function translateScratchEnToJaAPI(englishCode, dropdownTranslationsEnToJa) {
  const doc = sb.parse(englishCode, { languages: ['en'] });
  if (!doc) return { error: "Parse failed for English code", translatedCode: englishCode };

  const jaLangObject = sb.allLanguages['ja'];
  if (!jaLangObject || !jaLangObject.commands) return { error: "Japanese language data not loaded", translatedCode: doc.stringify() };

  // 1. ブロック全体の構造とテキストを日本語に変換
  doc.translate(jaLangObject);

  // 2. ASTを走査し、ドロップダウンの値を英語キーから日本語表示名に変換
  traverseAndTranslateDropdowns(doc, dropdownTranslationsEnToJa, 'en-to-ja');

  // 3. 翻訳・編集済みのASTから日本語コードを生成
  const japaneseCode = doc.stringify();

  return { translatedCode: japaneseCode };
}


// Express アプリケーションのセットアップ
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

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
    // custom_ja.json の dropdowns (英語キー -> 日本語値) を使う
    result = translateScratchEnToJaAPI(code, mapEnKeyToJaValue);
  } else if (direction === 'ja-to-en') {
    console.log(`API: Translating ja-to-en: ${code.substring(0,50)}...`);
    // custom_ja.json の dropdowns から生成した逆引きマップ (日本語値 -> 英語キー) を使う
    result = translateScratchJaToEnAPI(code, mapJaValueToEnKey);
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