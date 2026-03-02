import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Load persona prompt ────────────────────────────────
const personaPrompt = fs.readFileSync(
    path.join(__dirname, 'my_post.md'), 'utf-8'
);

// ── Gemini client (lazy init & dynamic model) ─────────────
const modelsCache = {};
function getModel(modelName) {
    if (!modelsCache[modelName]) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY が .env に設定されていません');
        const genAI = new GoogleGenerativeAI(apiKey);

        let apiModelName = modelName;
        // Map user-friendly names to actual API models
        if (modelName === 'gemini-3.1-pro') apiModelName = 'gemini-3.1-pro-preview';
        else if (modelName === 'gemini-3-flash') apiModelName = 'gemini-3-flash-preview';
        else if (modelName === 'gemini-2.5-flash-lite') apiModelName = 'gemini-2.5-flash-lite';

        modelsCache[modelName] = genAI.getGenerativeModel({ model: apiModelName });
    }
    return modelsCache[modelName];
}

// ── API: Generate post drafts ──────────────────────────
app.post('/api/generate', async (req, res) => {
    try {
        const { event, model } = req.body;
        if (!event || !event.trim()) {
            return res.status(400).json({ error: '出来事を入力してください' });
        }

        // Default to gemini-2.5-flash if not provided
        const selectedModel = model || 'gemini-3-flash';

        const prompt = `${personaPrompt}

## 指示
ユーザーが入力した「日常の出来事」を元に、上記のペルソナ・文体ルールに従ってXの投稿案を **5つ** 作成してください。

## 出力形式
必ず以下のJSON配列形式のみで出力してください。JSON以外のテキスト（説明、マークダウン記法など）は一切含めないでください。
["投稿案1","投稿案2","投稿案3","投稿案4","投稿案5"]

## 制約
- 各投稿は140文字以内にしてください（日本語全角基準）。
- 5つの投稿案はそれぞれ異なるパターンやトーンで作成してください（前述の投稿生成パターンを使い分けること）。
- ハッシュタグは基本的に使わないでください（ハレのスタイルに合わないため）。

## ユーザーの入力（今日あった出来事）
${event}`;

        const result = await getModel(selectedModel).generateContent(prompt);
        const content = result.response.text().trim();

        // Parse JSON from response (handles markdown code blocks)
        let drafts;
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                drafts = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('JSON not found in response');
            }
        } catch (parseErr) {
            console.error('Failed to parse AI response:', content);
            return res.status(500).json({ error: 'AI応答のパースに失敗しました。再試行してください。' });
        }

        res.json({ drafts });
    } catch (err) {
        console.error('Generate error:', err);
        const message = err.message?.includes('GEMINI_API_KEY')
            ? err.message
            : 'ポスト案の生成に失敗しました。';
        res.status(500).json({ error: message });
    }
});

// ── Start server ───────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 X Post Writer is running at http://localhost:${PORT}\n`);
});
