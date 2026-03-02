// ── Imports (browser ESM via importmap) ───────────────
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── State ──────────────────────────────────────────────
let selectedDraftIndex = -1;
let currentDrafts = [];
let currentTalkId = null;
let talks = [];
let cachedPersonaPrompt = null;

// ── DOM Elements ──────────────────────────────────────
const eventInput = document.getElementById('event-input');
const modelSelect = document.getElementById('model-select');
const generateBtn = document.getElementById('generate-btn');
const draftsSection = document.getElementById('drafts-section');
const draftsGrid = document.getElementById('drafts-grid');
const loading = document.getElementById('loading');
const regenerateBtn = document.getElementById('regenerate-btn');
const editSection = document.getElementById('edit-section');
const editInput = document.getElementById('edit-input');
const charCount = document.getElementById('char-count');
const charBarFill = document.getElementById('char-bar-fill');
const postBtn = document.getElementById('post-btn');
const toast = document.getElementById('toast');
const talksList = document.getElementById('talks-list');
const talkView = document.getElementById('talk-view');
const emptyState = document.getElementById('empty-state');
const likedList = document.getElementById('liked-list');

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    editInput.addEventListener('input', updateCharCounter);
    loadTalks();

    // Show settings modal if no API key saved
    const key = loadApiKey();
    if (!key) {
        openSettings();
    }

    // Close model dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select')) {
            const trigger = document.querySelector('.select-trigger');
            const options = document.getElementById('model-options');
            if (trigger && options) {
                trigger.classList.remove('open');
                options.classList.remove('show');
            }
        }
    });
});

// ── API Key Management ─────────────────────────────
const API_KEY_STORAGE_KEY = 'xpostwriter_gemini_api_key';
const PERSONA_STORAGE_KEY = 'xpostwriter_persona_prompt';
const USER_NAME_STORAGE_KEY = 'xpostwriter_user_name';
const USER_HANDLE_STORAGE_KEY = 'xpostwriter_user_handle';
const USER_AVATAR_STORAGE_KEY = 'xpostwriter_user_avatar';

const DEFAULT_USER_NAME = 'デフォルトくん';
const DEFAULT_USER_HANDLE = '@default';
const DEFAULT_AVATAR_PLACEHOLDER = 'avatar.png';

function loadApiKey() {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
}

function loadUserName() {
    return localStorage.getItem(USER_NAME_STORAGE_KEY) || DEFAULT_USER_NAME;
}

function loadUserHandle() {
    return localStorage.getItem(USER_HANDLE_STORAGE_KEY) || DEFAULT_USER_HANDLE;
}

function loadUserAvatar() {
    return localStorage.getItem(USER_AVATAR_STORAGE_KEY) || DEFAULT_AVATAR_PLACEHOLDER;
}

window.openSettings = function () {
    const modal = document.getElementById('settings-modal');
    modal.classList.add('open');
    const input = document.getElementById('api-key-input');
    input.value = loadApiKey();

    const nameInput = document.getElementById('user-name-input');
    const handleInput = document.getElementById('user-handle-input');
    const preview = document.getElementById('avatar-preview');
    nameInput.value = localStorage.getItem(USER_NAME_STORAGE_KEY) || '';
    handleInput.value = localStorage.getItem(USER_HANDLE_STORAGE_KEY) || '';

    const avatarData = localStorage.getItem(USER_AVATAR_STORAGE_KEY);
    if (avatarData) {
        preview.src = avatarData;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
        preview.src = '';
    }
};

window.closeSettings = function () {
    document.getElementById('settings-modal').classList.remove('open');
};

window.closeSettingsOnOverlay = function (e) {
    if (e.target === e.currentTarget) window.closeSettings();
};

window.handleAvatarUpload = function (event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) { // 2MB limit
        showToast('画像サイズは2MB以下にしてください', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const preview = document.getElementById('avatar-preview');
        preview.src = e.target.result;
        preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
};

window.saveApiKeyFromModal = function () {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) {
        showToast('APIキーを入力してください', 'error');
        return;
    }
    localStorage.setItem(API_KEY_STORAGE_KEY, key);

    // Save profile info
    const name = document.getElementById('user-name-input').value.trim();
    if (name) {
        localStorage.setItem(USER_NAME_STORAGE_KEY, name);
    } else {
        localStorage.removeItem(USER_NAME_STORAGE_KEY);
    }

    const handle = document.getElementById('user-handle-input').value.trim();
    if (handle) {
        localStorage.setItem(USER_HANDLE_STORAGE_KEY, handle);
    } else {
        localStorage.removeItem(USER_HANDLE_STORAGE_KEY);
    }

    const previewSrc = document.getElementById('avatar-preview').src;
    if (previewSrc && previewSrc.startsWith('data:')) {
        localStorage.setItem(USER_AVATAR_STORAGE_KEY, previewSrc);
    }

    // Update existing drafts avatar in DOM
    if (currentTalkId && talks.length > 0) {
        const talk = talks.find(t => t.id === currentTalkId);
        if (talk) renderDrafts(currentDrafts, talk.likedDrafts || []);
    }

    window.closeSettings();
    showToast('設定を保存しました', 'success');
};

window.toggleKeyVisibility = function () {
    const input = document.getElementById('api-key-input');
    input.type = input.type === 'password' ? 'text' : 'password';
};

// ── Persona Editor ────────────────────────────────
function loadSavedPersona() {
    return localStorage.getItem(PERSONA_STORAGE_KEY) || null;
}

window.openPersonaEditor = async function () {
    const modal = document.getElementById('persona-modal');
    modal.classList.add('open');
    const textarea = document.getElementById('persona-textarea');
    // Load saved persona or default from file
    const saved = loadSavedPersona();
    if (saved) {
        textarea.value = saved;
    } else {
        const fallback = await getPersonaPrompt();
        textarea.value = fallback;
    }
};

window.closePersonaEditor = function () {
    document.getElementById('persona-modal').classList.remove('open');
};

window.closePersonaOnOverlay = function (e) {
    if (e.target === e.currentTarget) window.closePersonaEditor();
};

window.savePersonaFromModal = function () {
    const text = document.getElementById('persona-textarea').value.trim();
    if (!text) {
        showToast('ペルソナ設定が空です', 'error');
        return;
    }
    localStorage.setItem(PERSONA_STORAGE_KEY, text);
    cachedPersonaPrompt = text; // Update cache immediately
    window.closePersonaEditor();
    showToast('ペルソナ設定を保存しました', 'success');
};

window.resetPersonaToDefault = async function () {
    // Fetch from file, ignoring cache
    cachedPersonaPrompt = null;
    localStorage.removeItem(PERSONA_STORAGE_KEY);
    const prompt = await getPersonaPrompt();
    document.getElementById('persona-textarea').value = prompt;
    showToast('ファイルの内容に戻しました');
};

// ── Talk Delete Confirm ────────────────────────────
let pendingDeleteTalkId = null;

window.deleteTalk = function (talkId, e) {
    if (e) e.stopPropagation();
    pendingDeleteTalkId = talkId;
    const talk = talks.find(t => t.id === talkId);
    const title = talk ? (talk.title || talk.event?.substring(0, 30) || '未タイトル') : 'このトーク';
    document.getElementById('delete-talk-message').textContent = `「${title}」を削除しますか？この操作は取り消せません。`;
    document.getElementById('delete-talk-modal').classList.add('open');
};

window.cancelDeleteTalk = function () {
    pendingDeleteTalkId = null;
    document.getElementById('delete-talk-modal').classList.remove('open');
};

window.cancelDeleteTalkOverlay = function (e) {
    if (e.target === e.currentTarget) window.cancelDeleteTalk();
};

window.confirmDeleteTalk = function () {
    if (!pendingDeleteTalkId) return;
    const id = pendingDeleteTalkId;
    pendingDeleteTalkId = null;
    document.getElementById('delete-talk-modal').classList.remove('open');

    talks = talks.filter(t => t.id !== id);
    saveTalks();
    if (currentTalkId === id) {
        showEmptyState();
    }
    renderTalksList();
    showToast('トークを削除しました');
};

// ── Mobile Sidebar ─────────────────────────────────
window.toggleMobileMenu = function () {
    const sidebar = document.getElementById('sidebar-left');
    const rightSidebar = document.getElementById('sidebar-right');
    const overlay = document.getElementById('sidebar-overlay');
    if (rightSidebar.classList.contains('open')) rightSidebar.classList.remove('open');
    sidebar.classList.toggle('open');
    if (sidebar.classList.contains('open')) overlay.classList.add('open');
    else overlay.classList.remove('open');
};

window.toggleLikesMenu = function () {
    const sidebar = document.getElementById('sidebar-right');
    const leftSidebar = document.getElementById('sidebar-left');
    const overlay = document.getElementById('sidebar-overlay');
    if (leftSidebar.classList.contains('open')) leftSidebar.classList.remove('open');
    sidebar.classList.toggle('open');
    if (sidebar.classList.contains('open')) overlay.classList.add('open');
    else overlay.classList.remove('open');
};

window.closeAllMobileMenus = function () {
    document.getElementById('sidebar-left').classList.remove('open');
    document.getElementById('sidebar-right').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
};

// ── Custom Dropdown Logic ─────────────────────────────
window.toggleModelDropdown = function (e) {
    if (e) e.stopPropagation();
    const trigger = document.querySelector('.select-trigger');
    const options = document.getElementById('model-options');
    trigger.classList.toggle('open');
    options.classList.toggle('show');
};

window.selectModelOption = function (element) {
    const value = element.getAttribute('data-value');
    const name = element.getAttribute('data-name');
    const icon = element.getAttribute('data-icon');
    const color = element.getAttribute('data-color');

    // Update hidden input
    document.getElementById('model-select').value = value;

    // Update trigger UI
    const triggerIcon = document.getElementById('selected-model-icon');
    const triggerName = document.getElementById('selected-model-name');
    triggerIcon.textContent = icon;
    triggerIcon.style.color = color;
    triggerIcon.style.background = `rgba(${hexToRgb(color)}, 0.1)`;
    triggerName.textContent = name;

    // Update selected class
    document.querySelectorAll('.select-option').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');

    // Save to talk if active
    if (currentTalkId) {
        const talk = talks.find(t => t.id === currentTalkId);
        if (talk) {
            talk.model = value;
            saveTalks();
        }
    }
};

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255';
}

// ── Talk Management ───────────────────────────────────

function loadTalks() {
    try {
        const saved = localStorage.getItem('xpostwriter_talks');
        if (saved) {
            talks = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load talks', e);
        talks = [];
    }
    renderTalksList();

    // If there are talks but none is selected, show empty state
    if (!currentTalkId) {
        showEmptyState();
    }
}

function saveTalks() {
    // Keep only the latest 50 talks
    if (talks.length > 50) {
        talks = talks.slice(0, 50);
    }
    localStorage.setItem('xpostwriter_talks', JSON.stringify(talks));
}

window.createNewTalk = function () {
    currentTalkId = 'talk_' + Date.now();
    const defaultModel = 'gemini-3-flash';

    talks.unshift({
        id: currentTalkId,
        date: new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date()),
        event: '',
        model: defaultModel,
        drafts: [],
        likedDrafts: []
    });

    saveTalks();
    switchToTalk(currentTalkId);

    // Reset UI to input step
    draftsSection.classList.add('hidden');
    editSection.classList.add('hidden');
    eventInput.focus();

    // Close mobile menu if open
    window.closeMobileMenu();
};

function switchToTalk(talkId) {
    currentTalkId = talkId;
    const talk = talks.find(t => t.id === currentTalkId);

    if (!talk) return;

    talkView.classList.remove('hidden');
    emptyState.classList.add('hidden');

    // Close mobile menu
    if (typeof window.closeAllMobileMenus === 'function') {
        window.closeAllMobileMenus();
    }

    // Restore event
    eventInput.value = talk.event || '';

    // Restore model
    const optionEl = document.querySelector(`.select-option[data-value="${talk.model}"]`);
    if (optionEl) {
        window.selectModelOption(optionEl);
    }

    // Restore drafts
    currentDrafts = talk.drafts || [];
    selectedDraftIndex = -1;

    if (currentDrafts.length > 0) {
        draftsSection.classList.remove('hidden');
        renderDrafts(currentDrafts, talk.likedDrafts || []);
        regenerateBtn.style.display = 'inline-flex';
    } else {
        draftsSection.classList.add('hidden');
        draftsGrid.innerHTML = '';
        regenerateBtn.style.display = 'none';
    }

    // Hide edit section
    editSection.classList.add('hidden');

    // Update sidebar highlight
    renderTalksList();
    renderLikedList();
}

function showEmptyState() {
    emptyState.classList.remove('hidden');
    talkView.classList.add('hidden');
    currentTalkId = null;
    renderTalksList();
    renderLikedList();
}

window.deleteTalk = window.deleteTalk; // defined above

window.editTalkTitle = function (talkId, e) {
    e.stopPropagation();
    const talk = talks.find(t => t.id === talkId);
    if (!talk) return;

    const newTitle = prompt('トークのタイトルを入力', talk.title || '');
    if (newTitle !== null) {
        talk.title = newTitle.trim();
        saveTalks();
        renderTalksList();
    }
};

function renderTalksList() {
    if (talks.length === 0) {
        talksList.innerHTML = '<div class="talks-empty">まだトークがありません</div>';
        return;
    }

    talksList.innerHTML = '';
    talks.forEach(talk => {
        const item = document.createElement('div');
        item.className = `talk-item ${talk.id === currentTalkId ? 'active' : ''}`;
        item.onclick = () => switchToTalk(talk.id);

        const preview = talk.title
            ? talk.title
            : talk.event
                ? talk.event.substring(0, 30) + (talk.event.length > 30 ? '…' : '')
                : '（未入力）';

        const likeCount = (talk.likedDrafts || []).length;
        const likeIndicator = likeCount > 0 ? ` <span style="color:var(--like-color);font-size:0.75rem;">❤️ ${likeCount}</span>` : '';

        item.innerHTML = `
            <div class="talk-item-header">
                <div class="talk-item-date">${escapeHtml(talk.date)}${likeIndicator}</div>
                <div class="talk-item-actions">
                    <button class="talk-item-edit-btn" onclick="editTalkTitle('${talk.id}', event)" title="タイトルを変更">✎</button>
                    <button class="talk-item-delete-btn" onclick="deleteTalk('${talk.id}', event)" title="削除">&times;</button>
                </div>
            </div>
            <div class="talk-item-preview">${escapeHtml(preview)}</div>
        `;
        talksList.appendChild(item);
    });
}

// ── Persona Prompt ────────────────────────────────────
async function getPersonaPrompt() {
    if (cachedPersonaPrompt) return cachedPersonaPrompt;
    try {
        const res = await fetch('my_post.md');
        if (!res.ok) throw new Error('Failed to load persona');
        cachedPersonaPrompt = await res.text();
    } catch (e) {
        // Fallback if file not available
        cachedPersonaPrompt = 'あなたはユーモアと共感を持ったTwitterユーザーです。自然な日本語でXの投稿案を作成してください。';
    }
    return cachedPersonaPrompt;
}

// ── Generate Drafts ───────────────────────────────────
window.generateDrafts = async function () {
    if (!currentTalkId) return;

    const event = eventInput.value.trim();
    const model = modelSelect.value;

    if (!event) {
        showToast('出来事を入力してください', 'error');
        eventInput.focus();
        return;
    }

    const apiKey = loadApiKey();
    if (!apiKey) {
        showToast('APIキーが未設定です。⚙で設定してください', 'error');
        openSettings();
        return;
    }

    // Save event to current talk
    const talk = talks.find(t => t.id === currentTalkId);
    if (talk) {
        talk.event = event;
        talk.model = model;
        saveTalks();
        renderTalksList();
    }

    // Show drafts section & loading
    draftsSection.classList.remove('hidden');
    loading.classList.add('active');
    regenerateBtn.style.display = 'none';
    editSection.classList.add('hidden');
    selectedDraftIndex = -1;
    generateBtn.disabled = true;
    generateBtn.querySelector('span').textContent = '生成中…';

    // Scroll to drafts section within main content only
    const mainContent = document.getElementById('main-content');
    setTimeout(() => {
        const draftsRect = draftsSection.getBoundingClientRect();
        const mainRect = mainContent.getBoundingClientRect();
        mainContent.scrollTop += (draftsRect.top - mainRect.top) - 20;
    }, 100);

    try {
        // Map model ID to actual API endpoint
        const MODEL_MAP = {
            'gemini-3.1-pro': 'gemini-3.1-pro-preview',
            'gemini-3-flash': 'gemini-3-flash-preview',
            'gemini-2.5-flash': 'gemini-2.5-flash',
            'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
        };
        const apiModelName = MODEL_MAP[model] || model;

        const personaPrompt = await getPersonaPrompt();
        const prompt = `${personaPrompt}

## 指示
ユーザーが入力した「日常の出来事」を元に、上記のペルソナ・文体ルールに従ってXの投稿案を **5つ** 作成してください。

## 出力形式
必ず以下のJSON配列形式のみで出力してください。JSON以外のテキスト（説明、マークダウン記法など）は一切含めないでください。
["投稿扨1","投稿扨2","投稿扨3","投稿扨4","投稿扨5"]

## 制約
- 各投稿は140文字以内にしてください（日本語全角基準）。
- 5つの投稿案はそれぞれ異なるパターンやトーンで作成してください。
- ハッシュタグは基本的に使わないでください。

## ユーザーの入力（今日あった出来事）
${event}`;

        const genAI = new GoogleGenerativeAI(apiKey);
        const genModel = genAI.getGenerativeModel({ model: apiModelName });
        const result = await genModel.generateContent(prompt);
        const content = result.response.text().trim();

        // Parse JSON from response
        let draftTexts;
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            draftTexts = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('AI応答のパースに失敗しました。再試行してください。');
        }

        // Append new drafts (keep existing ones)
        const newDrafts = draftTexts.map(text => ({ id: generateId(), text, model }));
        currentDrafts = [...currentDrafts, ...newDrafts];

        // Save to talk
        if (talk) {
            talk.drafts = currentDrafts;
            saveTalks();
        }

        renderDrafts(currentDrafts, talk ? talk.likedDrafts || [] : []);
    } catch (err) {
        console.error('Generate error:', err);
        if (err.message && err.message.includes('API_KEY_INVALID')) {
            showToast('APIキーが正しくありません。⚙で再設定してください', 'error');
        } else {
            showToast(err.message || 'ポスト案の生成に失敗しました', 'error');
        }
    } finally {
        loading.classList.remove('active');
        generateBtn.disabled = false;
        generateBtn.querySelector('span').textContent = 'ポスト案を生成';
        regenerateBtn.style.display = 'inline-flex';
    }
}

function generateId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

function isSameDraft(a, b) {
    const isObjA = typeof a === 'object' && a !== null;
    const isObjB = typeof b === 'object' && b !== null;

    if (isObjA && isObjB && a.id && b.id) {
        return a.id === b.id;
    }

    const textA = isObjA ? a.text : a;
    const textB = isObjB ? b.text : b;
    return textA === textB;
}

function renderDrafts(drafts, likedDrafts = []) {
    draftsGrid.innerHTML = '';

    drafts.forEach((draftItem, i) => {
        const isLiked = likedDrafts.some(liked => isSameDraft(liked, draftItem));
        const text = typeof draftItem === 'string' ? draftItem : draftItem.text;
        const model = typeof draftItem === 'string' ? 'unknown' : draftItem.model;

        let modelBadgeHtml = '';
        if (model === 'edited') {
            modelBadgeHtml = `<span class="draft-model-badge" style="color: #00ba7c; background: rgba(0, 186, 124, 0.1);">✍️ Edited</span>`;
        } else if (model === 'gemini-3.1-pro') {
            modelBadgeHtml = `<span class="draft-model-badge" style="color: #c840e9; background: rgba(200, 64, 233, 0.1);">🧠 3.1 Pro</span>`;
        } else if (model === 'gemini-3-flash') {
            modelBadgeHtml = `<span class="draft-model-badge" style="color: #ffd400; background: rgba(255, 212, 0, 0.1);">⚡ 3 Flash</span>`;
        } else if (model === 'gemini-2.5-flash') {
            modelBadgeHtml = `<span class="draft-model-badge" style="color: #1d9bf0; background: rgba(29, 155, 240, 0.1);">🚀 2.5 Flash</span>`;
        } else if (model === 'gemini-2.5-flash-lite') {
            modelBadgeHtml = `<span class="draft-model-badge" style="color: #00ba7c; background: rgba(0, 186, 124, 0.1);">🍃 2.5 Lite</span>`;
        }

        const userName = loadUserName();
        const userHandle = loadUserHandle();
        const avatarUrl = loadUserAvatar();

        const card = document.createElement('div');
        card.className = 'draft-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.innerHTML = `
            <div class="draft-card-header">
                <img class="draft-avatar" src="${escapeHtml(avatarUrl)}" alt="avatar">
                <div class="draft-user-info">
                    <span class="draft-username">${escapeHtml(userName)}</span>
                    <span class="draft-handle">${escapeHtml(userHandle)}</span>
                </div>
                <span class="draft-number">#${i + 1}</span>
                ${modelBadgeHtml}
                <button class="draft-delete-btn" onclick="deleteDraft(${i}, event)" title="この案を削除">×</button>
            </div>
            <p class="draft-text">${escapeHtml(text)}</p>
            <div class="draft-card-footer">
                <button class="draft-like-btn ${isLiked ? 'liked' : ''}" onclick="toggleLike(${i}, event)" title="いいね">
                    ${isLiked ? '❤️' : '🤍'}
                </button>
            </div>
        `;
        card.addEventListener('click', (e) => {
            // Don't select if clicking the like or delete button
            if (e.target.closest('.draft-like-btn') || e.target.closest('.draft-delete-btn')) return;
            selectDraft(i);
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectDraft(i);
            }
        });
        draftsGrid.appendChild(card);
    });

    regenerateBtn.style.display = 'inline-flex';
}

window.deleteDraft = function (draftIndex, e) {
    e.stopPropagation();
    if (!currentTalkId) return;

    const talk = talks.find(t => t.id === currentTalkId);
    if (!talk) return;

    const draft = currentDrafts[draftIndex];
    if (!draft) return;

    // Remove from currentDrafts
    currentDrafts.splice(draftIndex, 1);
    talk.drafts = currentDrafts;

    // Remove from likedDrafts if exists
    if (talk.likedDrafts) {
        const likedIndex = talk.likedDrafts.findIndex(liked => isSameDraft(liked, draft));
        if (likedIndex !== -1) {
            talk.likedDrafts.splice(likedIndex, 1);
        }
    }

    saveTalks();
    renderDrafts(currentDrafts, talk.likedDrafts || []);
    renderLikedList();
    renderTalksList();

    // If currently selected draft is deleted, hide edit section
    if (selectedDraftIndex === draftIndex) {
        editSection.classList.add('hidden');
        selectedDraftIndex = -1;
    } else if (selectedDraftIndex > draftIndex) {
        // Adjust selected index
        selectedDraftIndex--;
        updateSelectedCardStyle();
    }

    showToast('削除しました');
};

window.saveEditedDraft = function () {
    if (!currentTalkId) return;
    const talk = talks.find(t => t.id === currentTalkId);
    if (!talk) return;

    const editedText = editInput.value.trim();
    if (!editedText) {
        showToast('テキストが入力されていません', 'error');
        return;
    }

    // Add to current drafts list as edited object
    const newDraftObj = { id: generateId(), text: editedText, model: 'edited' };
    currentDrafts.push(newDraftObj);
    talk.drafts = currentDrafts;

    // Auto like it so it shows in right sidebar
    if (!talk.likedDrafts) talk.likedDrafts = [];
    if (!talk.likedDrafts.some(liked => isSameDraft(liked, newDraftObj))) {
        talk.likedDrafts.push(newDraftObj);
    }

    saveTalks();
    renderDrafts(currentDrafts, talk.likedDrafts);
    renderLikedList();
    renderTalksList();

    // Select the newly added draft
    selectDraft(currentDrafts.length - 1);

    // Auto scroll to the new card
    setTimeout(() => {
        const lastCard = draftsGrid.lastElementChild;
        if (lastCard) {
            const mainContent = document.getElementById('main-content');
            const cardRect = lastCard.getBoundingClientRect();
            const mainRect = mainContent.getBoundingClientRect();
            mainContent.scrollTop += (cardRect.top - mainRect.top) - 100;
        }
    }, 100);

    showToast('手直しした案を保存しました', 'success');
}

function updateSelectedCardStyle() {
    document.querySelectorAll('.draft-card').forEach((card, i) => {
        card.classList.toggle('selected', i === selectedDraftIndex);
    });
}

window.toggleLike = function (draftIndex, e) {
    e.stopPropagation();
    if (!currentTalkId) return;

    const talk = talks.find(t => t.id === currentTalkId);
    if (!talk) return;

    const draft = currentDrafts[draftIndex];
    if (!draft) return;

    if (!talk.likedDrafts) talk.likedDrafts = [];

    const likedIndex = talk.likedDrafts.findIndex(liked => isSameDraft(liked, draft));
    if (likedIndex !== -1) {
        // Unlike
        talk.likedDrafts.splice(likedIndex, 1);
        showToast('いいねを解除しました');
    } else {
        // Like
        talk.likedDrafts.push(draft);
        showToast('いいねしました！', 'success');
        createHeartExplosion(e);
    }

    saveTalks();
    renderDrafts(currentDrafts, talk.likedDrafts);
    renderLikedList();
    renderTalksList();
}

function selectDraft(index) {
    selectedDraftIndex = index;

    // Update card states
    updateSelectedCardStyle();

    // Show edit section
    editSection.classList.remove('hidden');
    const draftItem = currentDrafts[index];
    editInput.value = typeof draftItem === 'string' ? draftItem : draftItem.text;
    updateCharCounter();

    // Scroll to edit section within main content only (avoid sidebar scroll)
    const mainContent = document.getElementById('main-content');
    setTimeout(() => {
        const editRect = editSection.getBoundingClientRect();
        const mainRect = mainContent.getBoundingClientRect();
        mainContent.scrollTop += (editRect.top - mainRect.top) - 100;
    }, 100);
}

// ── Liked List (Right Sidebar) ────────────────────────
function renderLikedList() {
    if (!currentTalkId) {
        likedList.innerHTML = '<div class="liked-empty">トークを開くと表示されます</div>';
        return;
    }

    const talk = talks.find(t => t.id === currentTalkId);
    const liked = talk ? (talk.likedDrafts || []) : [];

    if (liked.length === 0) {
        likedList.innerHTML = '<div class="liked-empty">気に入ったポスト案に❤️しよう</div>';
        return;
    }

    likedList.innerHTML = '';
    liked.forEach((draftItem, i) => {
        const text = typeof draftItem === 'string' ? draftItem : draftItem.text;
        const card = document.createElement('div');
        card.className = 'liked-card';
        card.onclick = () => {
            const indexInDrafts = currentDrafts.findIndex(d => isSameDraft(d, draftItem));
            if (indexInDrafts !== -1) {
                // 中央のリストに同じポストがあれば、それを選択状態にしてハイライト・スクロール・編集エリアへの反映を全て行う
                selectDraft(indexInDrafts);
            } else {
                // 念のため、見つからなかった場合のフォールバック
                editSection.classList.remove('hidden');
                editInput.value = text;
                updateCharCounter();
                const mainContent = document.getElementById('main-content');
                setTimeout(() => {
                    const editRect = editSection.getBoundingClientRect();
                    const mainRect = mainContent.getBoundingClientRect();
                    mainContent.scrollTop += (editRect.top - mainRect.top) - 100;
                }, 100);
            }
        };
        card.innerHTML = `
            <div class="liked-card-text">${escapeHtml(text)}</div>
            <div class="liked-card-actions">
                <button class="unlike-btn" onclick="unlikeFromSidebar(${i}, event)" title="いいね解除">❤️ 解除</button>
            </div>
        `;
        likedList.appendChild(card);
    });
}

window.unlikeFromSidebar = function (likedIndex, e) {
    e.stopPropagation();
    if (!currentTalkId) return;

    const talk = talks.find(t => t.id === currentTalkId);
    if (!talk || !talk.likedDrafts) return;

    talk.likedDrafts.splice(likedIndex, 1);
    saveTalks();
    renderDrafts(currentDrafts, talk.likedDrafts);
    renderLikedList();
    renderTalksList();
    showToast('いいねを解除しました');
}

// ── Character Counter ─────────────────────────────────
function updateCharCounter() {
    const len = editInput.value.length;
    charCount.textContent = len;

    const pct = Math.min((len / 140) * 100, 100);
    charBarFill.style.width = `${pct}%`;

    charBarFill.classList.remove('warning', 'danger');
    if (pct >= 100) {
        charBarFill.classList.add('danger');
    } else if (pct >= 85) {
        charBarFill.classList.add('warning');
    }
}

// ── Post to X via Web Intent ──────────────────────────
window.postToX = function () {
    const text = editInput.value.trim();
    if (!text) {
        showToast('投稿内容が空です', 'error');
        return;
    }

    // X Web Intent URL — opens X's compose screen with pre-filled text
    const intentUrl = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    window.open(intentUrl, '_blank', 'width=600,height=400');

    showToast('Xの投稿画面を開きました！', 'success');
}

// ── Toast ─────────────────────────────────────────────
let toastTimeout;
function showToast(message, type = '') {
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.className = 'toast visible ' + type;
    toastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, 3500);
}

// ── Heart Animation ───────────────────────────────────
function createHeartExplosion(e) {
    const rect = e.target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // 生成するハートの数
    const numHearts = 10;

    for (let i = 0; i < numHearts; i++) {
        const heart = document.createElement('div');
        heart.innerHTML = '❤️';
        heart.className = 'floating-heart';

        // ランダムな飛び散り方向と回転
        const angle = Math.random() * Math.PI * 2;
        const velocity = 50 + Math.random() * 80;
        const tx = Math.cos(angle) * velocity;
        const ty = Math.sin(angle) * velocity - 50; // 少し上に向かって飛ぶ
        const startRot = Math.random() * 60 - 30;
        const endRot = startRot + (Math.random() * 180 - 90);

        heart.style.left = `${x}px`;
        heart.style.top = `${y}px`;
        heart.style.setProperty('--tx', `${tx}px`);
        heart.style.setProperty('--ty', `${ty}px`);
        heart.style.setProperty('--start-rot', `${startRot}deg`);
        heart.style.setProperty('--end-rot', `${endRot}deg`);

        // 少しずつ遅延させて生成
        heart.style.animationDelay = `${Math.random() * 0.1}s`;

        document.body.appendChild(heart);

        // アニメーションが終わったら削除
        setTimeout(() => {
            heart.remove();
        }, 1200);
    }
}

// ── Utilities ─────────────────────────────────────────
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
