// ===== STATE =====
const state = { documents: {}, annotations: {}, positions: {}, settings: {} };
let currentDocId = null;
let currentView = 'library';
let fontSize = 18; // px
let activeAnnotationType = null; // 'vocab' | 'grammar' | null
let popoverAnnotationId = null;
let scrollDebounceTimer = null;

// ===== DEFAULT PROMPT TEMPLATES =====
const DEFAULT_VOCAB_TEMPLATE = `I am learning German. Below are words and phrases I encountered while reading that I do not yet know. For each item, please:
1. Give the English meaning (and for nouns: the grammatical gender and plural form).
2. Explain the nuance or register (formal, colloquial, literary, etc.) if relevant.
3. Show 2\u20133 short example sentences in German (with English translations) that illustrate natural usage.
4. Give me a memorable tip or mnemonic to help me remember this word.

Please format each entry with a clear heading showing the word or phrase.

--- VOCABULARY LIST ---

{items}`;

const DEFAULT_GRAMMAR_TEMPLATE = `I am learning German. Below are sentence fragments or grammatical structures I encountered while reading that I do not yet understand. For each item, please:
1. Identify and name the grammatical structure (e.g. "Konjunktiv II", "separable verb in past tense", "genitive with preposition").
2. Explain the rule clearly and concisely.
3. Show 2\u20133 additional example sentences in German (with English translations) that use the same structure.
4. Finally, give me 2 sentences in English for me to translate into German, so I can verify my understanding. (Do not provide the answers yet \u2014 wait for me to reply.)

Please format each entry with a clear heading showing the fragment or structure.

--- GRAMMAR STRUCTURES ---

{items}`;

function getVocabTemplate() {
  return state.settings.vocabTemplate || DEFAULT_VOCAB_TEMPLATE;
}
function getGrammarTemplate() {
  return state.settings.grammarTemplate || DEFAULT_GRAMMAR_TEMPLATE;
}

// ===== DATA LAYER =====
async function loadData() {
  const res = await fetch('/api/data');
  if (!res.ok) {
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    return;
  }
  const json = await res.json();
  state.documents = json.documents || {};
  state.annotations = json.annotations || {};
  state.positions = json.positions || {};
  state.settings = json.settings || {};
}

async function saveData() {
  const res = await fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
  if (res.status === 401) { window.location.href = '/login.html'; }
}

// ===== VIEW SWITCHING =====
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + name).classList.remove('hidden');
  currentView = name;
}

// ===== LIBRARY VIEW =====
function renderLibrary() {
  const list = document.getElementById('library-list');
  const empty = document.getElementById('library-empty');
  const docIds = Object.keys(state.documents);

  if (docIds.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Sort by upload date descending
  docIds.sort((a, b) => (state.documents[b].uploadedAt || 0) - (state.documents[a].uploadedAt || 0));

  list.innerHTML = docIds.map(docId => {
    const doc = state.documents[docId];
    const annotations = state.annotations[docId] || [];
    const vocabCount = annotations.filter(a => a.type === 'vocab').length;
    const grammarCount = annotations.filter(a => a.type === 'grammar').length;
    const date = new Date(doc.uploadedAt).toLocaleDateString();
    const chars = doc.text ? doc.text.length.toLocaleString() : '?';

    return `<div class="doc-card" data-id="${docId}">
      <div class="doc-card-info">
        <div class="doc-card-title">${escapeHtml(doc.title)}</div>
        <div class="doc-card-meta">Uploaded ${date} &middot; ${chars} characters</div>
      </div>
      <div class="doc-card-badges">
        ${vocabCount > 0 ? `<span class="badge badge-vocab">${vocabCount} vocab</span>` : ''}
        ${grammarCount > 0 ? `<span class="badge badge-grammar">${grammarCount} grammar</span>` : ''}
        <button class="btn btn-delete-doc" data-delete="${docId}" title="Delete document">&#10005;</button>
      </div>
    </div>`;
  }).join('');

  // Card click opens reader
  list.querySelectorAll('.doc-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete]')) return; // don't open reader when deleting
      openReader(card.dataset.id);
    });
  });

  // Delete buttons
  list.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const docId = btn.dataset.delete;
      const title = state.documents[docId]?.title || 'this document';
      if (!confirm(`Delete "${title}"? This also removes all annotations.`)) return;
      await fetch('/api/document/' + docId, { method: 'DELETE' });
      await loadData();
      renderLibrary();
    });
  });

  renderLibrarySidebar();
}

// ===== LIBRARY SIDEBAR =====
function renderLibrarySidebar() {
  const vocabContainer = document.getElementById('lib-sidebar-vocab');
  const grammarContainer = document.getElementById('lib-sidebar-grammar');
  const vocabEmpty = document.getElementById('lib-sidebar-vocab-empty');
  const grammarEmpty = document.getElementById('lib-sidebar-grammar-empty');

  const docIds = Object.keys(state.documents);

  // Gather all vocab and grammar grouped by document
  let hasVocab = false;
  let hasGrammar = false;
  let vocabHtml = '';
  let grammarHtml = '';

  for (const docId of docIds) {
    const doc = state.documents[docId];
    const annotations = state.annotations[docId] || [];
    const vocabItems = annotations.filter(a => a.type === 'vocab');
    const grammarItems = annotations.filter(a => a.type === 'grammar');

    if (vocabItems.length > 0) {
      hasVocab = true;
      vocabHtml += buildSidebarGroup(doc.title, vocabItems, 'vocab');
    }
    if (grammarItems.length > 0) {
      hasGrammar = true;
      grammarHtml += buildSidebarGroup(doc.title, grammarItems, 'grammar');
    }
  }

  if (hasVocab) {
    vocabEmpty.classList.add('hidden');
    vocabContainer.innerHTML = vocabHtml;
  } else {
    vocabEmpty.classList.remove('hidden');
    vocabContainer.innerHTML = '';
  }

  if (hasGrammar) {
    grammarEmpty.classList.add('hidden');
    grammarContainer.innerHTML = grammarHtml;
  } else {
    grammarEmpty.classList.remove('hidden');
    grammarContainer.innerHTML = '';
  }

  // Toggle collapse/expand
  document.querySelectorAll('.lib-sidebar-group-header').forEach(header => {
    header.addEventListener('click', () => {
      const items = header.nextElementSibling;
      const chevron = header.querySelector('.chevron');
      items.classList.toggle('expanded');
      chevron.classList.toggle('expanded');
    });
  });
}

function buildSidebarGroup(title, items, type) {
  const itemsHtml = items.map(a =>
    `<div class="sidebar-item ${type}">
      <div class="sidebar-item-text">${escapeHtml(a.text)}</div>
    </div>`
  ).join('');

  return `<div class="lib-sidebar-group">
    <div class="lib-sidebar-group-header">
      <span class="chevron">&#9654;</span>
      <span class="group-title">${escapeHtml(title)}</span>
      <span class="group-count">(${items.length})</span>
    </div>
    <div class="lib-sidebar-group-items">${itemsHtml}</div>
  </div>`;
}

// ===== UPLOAD =====
document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset so same file can be re-uploaded

  const statusEl = document.getElementById('upload-status');
  statusEl.textContent = `Uploading "${file.name}"…`;
  statusEl.className = 'upload-status uploading';
  statusEl.classList.remove('hidden');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const json = await res.json();
    if (!res.ok) {
      statusEl.textContent = json.error || 'Upload failed.';
      statusEl.className = 'upload-status error';
      return;
    }
    statusEl.textContent = `"${json.title}" uploaded — ${json.charCount.toLocaleString()} characters extracted.`;
    statusEl.className = 'upload-status success';
    await loadData();
    renderLibrary();
    setTimeout(() => statusEl.classList.add('hidden'), 4000);
  } catch (err) {
    statusEl.textContent = 'Upload failed: ' + err.message;
    statusEl.className = 'upload-status error';
  }
});

// ===== READER VIEW =====
function openReader(docId) {
  currentDocId = docId;
  document.getElementById('reader-title').textContent = state.documents[docId]?.title || '';
  renderReader();
  showView('reader');

  // Restore scroll position after render
  requestAnimationFrame(() => {
    const scrollEl = document.getElementById('reader-scroll');
    const savedPos = state.positions[docId];
    if (savedPos) scrollEl.scrollTop = savedPos;
  });

  updateReaderStatus();
}

function renderReader() {
  const doc = state.documents[currentDocId];
  if (!doc) return;
  const rawText = doc.text;
  const annotations = (state.annotations[currentDocId] || []).slice().sort((a, b) => a.startOffset - b.startOffset);

  const content = document.getElementById('reader-content');
  content.style.fontSize = fontSize + 'px';
  content.innerHTML = buildAnnotatedHtml(rawText, annotations);
}

function buildAnnotatedHtml(text, annotations) {
  // Remove overlapping/invalid annotations
  const valid = [];
  let lastEnd = -1;
  for (const ann of annotations) {
    if (ann.startOffset >= 0 && ann.endOffset > ann.startOffset && ann.startOffset >= lastEnd) {
      valid.push(ann);
      lastEnd = ann.endOffset;
    }
  }

  let html = '';
  let cursor = 0;
  for (const ann of valid) {
    if (ann.startOffset > cursor) {
      html += formatText(text.slice(cursor, ann.startOffset));
    }
    const marked = escapeHtml(text.slice(ann.startOffset, ann.endOffset));
    html += `<mark class="${ann.type}" data-id="${ann.id}">${marked}</mark>`;
    cursor = ann.endOffset;
  }
  if (cursor < text.length) {
    html += formatText(text.slice(cursor));
  }
  return html;
}

function formatText(text) {
  return escapeHtml(text);
}

// Font size controls
document.getElementById('btn-font-down').addEventListener('click', () => {
  if (fontSize > 12) { fontSize -= 2; renderReader(); }
});
document.getElementById('btn-font-up').addEventListener('click', () => {
  if (fontSize < 32) { fontSize += 2; renderReader(); }
});

// Scroll position saving
document.getElementById('reader-scroll').addEventListener('scroll', () => {
  if (!currentDocId) return;
  clearTimeout(scrollDebounceTimer);
  scrollDebounceTimer = setTimeout(() => {
    state.positions[currentDocId] = document.getElementById('reader-scroll').scrollTop;
    saveData();
  }, 500);
});

// ===== ANNOTATION VIA DOUBLE-CLICK (vocab) and RIGHT-CLICK (grammar) =====
// Double-click a word → vocabulary
// Select text, then right-click → grammar

document.getElementById('reader-content').addEventListener('dblclick', (e) => {
  if (e.target.closest('mark')) return;

  const content = document.getElementById('reader-content');
  const rawText = state.documents[currentDocId]?.text;
  if (!rawText) return;

  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const selectedText = selection.toString().trim();
  if (!selectedText) return;

  const offsets = selectionToOffsets(selection, content, rawText);
  if (!offsets) { selection.removeAllRanges(); return; }

  const sentence = extractSentence(rawText, offsets.startOffset, offsets.endOffset);

  const annotation = {
    id: crypto.randomUUID(),
    type: 'vocab',
    text: selectedText,
    sentence,
    startOffset: offsets.startOffset,
    endOffset: offsets.endOffset,
    createdAt: Date.now()
  };

  if (!state.annotations[currentDocId]) state.annotations[currentDocId] = [];
  state.annotations[currentDocId].push(annotation);
  saveData();
  selection.removeAllRanges();
  renderReader();
  updateReaderStatus();
});

document.getElementById('reader-content').addEventListener('contextmenu', (e) => {
  const content = document.getElementById('reader-content');
  const rawText = state.documents[currentDocId]?.text;
  if (!rawText) return;

  // If right-clicking on an existing annotation → show remove popover
  const markEl = e.target.closest('mark');
  if (markEl) {
    e.preventDefault();
    onMarkRightClick(e, markEl);
    return;
  }

  // If there's a multi-word selection → add as grammar
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return;

  const selectedText = selection.toString().trim();
  if (!selectedText || !selectedText.includes(' ')) return;

  e.preventDefault();

  let offsets = selectionToOffsets(selection, content, rawText);
  if (!offsets) { selection.removeAllRanges(); return; }

  // Expand selection to full word boundaries
  offsets = expandToWordBoundaries(rawText, offsets.startOffset, offsets.endOffset);
  const expandedText = rawText.slice(offsets.startOffset, offsets.endOffset).trim();

  const sentence = extractSentence(rawText, offsets.startOffset, offsets.endOffset);

  const annotation = {
    id: crypto.randomUUID(),
    type: 'grammar',
    text: expandedText,
    sentence,
    startOffset: offsets.startOffset,
    endOffset: offsets.endOffset,
    createdAt: Date.now()
  };

  if (!state.annotations[currentDocId]) state.annotations[currentDocId] = [];
  state.annotations[currentDocId].push(annotation);
  saveData();
  selection.removeAllRanges();
  renderReader();
  updateReaderStatus();
});

function selectionToOffsets(selection, contentEl, rawText) {
  // Walk all text nodes in contentEl in order, accumulating raw-text offsets.
  // Map the DOM selection's anchor/focus nodes + offsets to raw text offsets.
  const range = selection.getRangeAt(0);
  let charCount = 0;
  let startOffset = null;
  let endOffset = null;

  const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (node === range.startContainer) {
      startOffset = charCount + range.startOffset;
    }
    if (node === range.endContainer) {
      endOffset = charCount + range.endOffset;
      break;
    }
    charCount += len;
  }

  if (startOffset === null || endOffset === null || startOffset >= endOffset) return null;
  // Clamp to text length
  startOffset = Math.max(0, Math.min(startOffset, rawText.length));
  endOffset = Math.max(0, Math.min(endOffset, rawText.length));
  if (startOffset >= endOffset) return null;
  return { startOffset, endOffset };
}

function expandToWordBoundaries(text, start, end) {
  // Expand start to the left until we hit a space/newline or beginning of text
  while (start > 0 && !/\s/.test(text[start - 1])) start--;
  // Expand end to the right until we hit a space/newline or end of text
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { startOffset: start, endOffset: end };
}

function extractSentence(text, start, end) {
  const sentenceEnds = /[.!?]/;

  // Scan left from start to find sentence boundary
  let left = start - 1;
  while (left > 0 && !sentenceEnds.test(text[left])) left--;
  if (sentenceEnds.test(text[left])) left++;
  while (left < start && /[\s\n]/.test(text[left])) left++;

  // Scan right from end to find sentence boundary
  let right = end;
  while (right < text.length && !sentenceEnds.test(text[right])) right++;
  if (right < text.length) right++; // include the punctuation

  let sentence = text.slice(left, right).trim();

  // If sentence is too short, expand right to include the next sentence for context
  if (sentence.length < 40 && right < text.length) {
    let right2 = right;
    while (right2 < text.length && /[\s\n]/.test(text[right2])) right2++;
    while (right2 < text.length && !sentenceEnds.test(text[right2])) right2++;
    if (right2 < text.length) right2++;
    sentence = text.slice(left, right2).trim();
  }

  // Clean up excessive whitespace/newlines within the sentence
  sentence = sentence.replace(/\s+/g, ' ');

  return sentence;
}

// ===== ANNOTATION RIGHT-CLICK REMOVAL =====
function onMarkRightClick(e, markEl) {
  popoverAnnotationId = markEl.dataset.id;
  const popover = document.getElementById('annotation-popover');
  popover.style.left = e.clientX + 'px';
  popover.style.top = e.clientY + 'px';
  popover.classList.remove('hidden');
}

document.getElementById('btn-remove-annotation').addEventListener('click', () => {
  if (!popoverAnnotationId || !currentDocId) return;
  state.annotations[currentDocId] = (state.annotations[currentDocId] || [])
    .filter(a => a.id !== popoverAnnotationId);
  saveData();
  renderReader();
  updateReaderStatus();
  document.getElementById('annotation-popover').classList.add('hidden');
  popoverAnnotationId = null;
});

// Close popover on click elsewhere
document.addEventListener('click', (e) => {
  if (!e.target.closest('#annotation-popover')) {
    document.getElementById('annotation-popover').classList.add('hidden');
  }
});

// ===== READER STATUS BAR =====
function updateReaderStatus() {
  const doc = state.documents[currentDocId];
  const annotations = state.annotations[currentDocId] || [];
  const vocabCount = annotations.filter(a => a.type === 'vocab').length;
  const grammarCount = annotations.filter(a => a.type === 'grammar').length;

  document.getElementById('status-doc-info').textContent =
    doc ? `${doc.text.length.toLocaleString()} characters` : '';
  document.getElementById('status-annotation-count').textContent =
    `${vocabCount} vocabulary · ${grammarCount} grammar annotations`;

  renderSidebar();
}

// ===== SIDEBAR =====
function renderSidebar() {
  const annotations = state.annotations[currentDocId] || [];
  const vocabItems = annotations.filter(a => a.type === 'vocab');
  const grammarItems = annotations.filter(a => a.type === 'grammar');

  const vocabList = document.getElementById('sidebar-vocab-list');
  const grammarList = document.getElementById('sidebar-grammar-list');
  const vocabEmpty = document.getElementById('sidebar-vocab-empty');
  const grammarEmpty = document.getElementById('sidebar-grammar-empty');

  if (vocabItems.length > 0) {
    vocabEmpty.classList.add('hidden');
    vocabList.innerHTML = vocabItems.map(a => `
      <li class="sidebar-item vocab" data-offset="${a.startOffset}">
        <div class="sidebar-item-row">
          <div class="sidebar-item-text">${escapeHtml(a.text)}</div>
          <button class="sidebar-remove" data-id="${a.id}" title="Remove">&times;</button>
        </div>
        <div class="sidebar-item-context">${escapeHtml(a.sentence)}</div>
      </li>`).join('');
  } else {
    vocabEmpty.classList.remove('hidden');
    vocabList.innerHTML = '';
  }

  if (grammarItems.length > 0) {
    grammarEmpty.classList.add('hidden');
    grammarList.innerHTML = grammarItems.map(a => `
      <li class="sidebar-item grammar" data-offset="${a.startOffset}">
        <div class="sidebar-item-row">
          <div class="sidebar-item-text">${escapeHtml(a.text)}</div>
          <button class="sidebar-remove" data-id="${a.id}" title="Remove">&times;</button>
        </div>
        <div class="sidebar-item-context">${escapeHtml(a.sentence)}</div>
      </li>`).join('');
  } else {
    grammarEmpty.classList.remove('hidden');
    grammarList.innerHTML = '';
  }

  // Click sidebar item → scroll to that annotation in the text
  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar-remove')) return;
      const offset = item.dataset.offset;
      const marks = document.querySelectorAll('#reader-content mark');
      for (const m of marks) {
        const ann = (state.annotations[currentDocId] || []).find(a => a.id === m.dataset.id);
        if (ann && String(ann.startOffset) === offset) {
          m.scrollIntoView({ behavior: 'smooth', block: 'center' });
          m.style.outline = '3px solid #333';
          setTimeout(() => { m.style.outline = ''; }, 1500);
          break;
        }
      }
    });
  });

  // Remove buttons in sidebar
  document.querySelectorAll('.sidebar-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const annId = btn.dataset.id;
      state.annotations[currentDocId] = (state.annotations[currentDocId] || [])
        .filter(a => a.id !== annId);
      saveData();
      renderReader();
      updateReaderStatus();
    });
  });
}

// ===== NAVIGATION =====
document.getElementById('btn-back-library').addEventListener('click', () => {
  showView('library');
  renderLibrary();
});

document.getElementById('btn-go-export').addEventListener('click', () => {
  renderExport();
  showView('export');
});

document.getElementById('btn-back-reader').addEventListener('click', () => {
  showView('reader');
});

// ===== EXPORT VIEW =====
function buildVocabPrompt(docId) {
  const items = (state.annotations[docId] || [])
    .filter(a => a.type === 'vocab')
    .map(a => `Word/Phrase: "${a.text}"\nContext sentence: "${a.sentence}"`)
    .join('\n\n');
  if (!items) return null;
  return getVocabTemplate().replace('{items}', items);
}

function buildGrammarPrompt(docId) {
  const items = (state.annotations[docId] || [])
    .filter(a => a.type === 'grammar')
    .map(a => `Fragment/Structure: "${a.text}"\nContext sentence: "${a.sentence}"`)
    .join('\n\n');
  if (!items) return null;
  return getGrammarTemplate().replace('{items}', items);
}

function renderExport() {
  const doc = state.documents[currentDocId];
  document.getElementById('export-title').textContent = doc?.title || '';

  const annotations = state.annotations[currentDocId] || [];
  const vocabAnnotations = annotations.filter(a => a.type === 'vocab');
  const grammarAnnotations = annotations.filter(a => a.type === 'grammar');

  const vocabPrompt = buildVocabPrompt(currentDocId);
  const grammarPrompt = buildGrammarPrompt(currentDocId);

  // Vocab panel
  document.getElementById('vocab-count').textContent = `${vocabAnnotations.length} word${vocabAnnotations.length !== 1 ? 's' : ''} marked`;
  if (vocabPrompt) {
    document.getElementById('vocab-prompt').textContent = vocabPrompt;
    document.getElementById('vocab-prompt').classList.remove('hidden');
    document.getElementById('vocab-empty').classList.add('hidden');
    document.getElementById('btn-copy-vocab').disabled = false;
    document.getElementById('btn-gemini-vocab').disabled = false;
    document.getElementById('btn-download-vocab').disabled = false;
  } else {
    document.getElementById('vocab-prompt').classList.add('hidden');
    document.getElementById('vocab-empty').classList.remove('hidden');
    document.getElementById('btn-copy-vocab').disabled = true;
    document.getElementById('btn-gemini-vocab').disabled = true;
    document.getElementById('btn-download-vocab').disabled = true;
  }

  // Grammar panel
  document.getElementById('grammar-count').textContent = `${grammarAnnotations.length} structure${grammarAnnotations.length !== 1 ? 's' : ''} marked`;
  if (grammarPrompt) {
    document.getElementById('grammar-prompt').textContent = grammarPrompt;
    document.getElementById('grammar-prompt').classList.remove('hidden');
    document.getElementById('grammar-empty').classList.add('hidden');
    document.getElementById('btn-copy-grammar').disabled = false;
    document.getElementById('btn-gemini-grammar').disabled = false;
    document.getElementById('btn-download-grammar').disabled = false;
  } else {
    document.getElementById('grammar-prompt').classList.add('hidden');
    document.getElementById('grammar-empty').classList.remove('hidden');
    document.getElementById('btn-copy-grammar').disabled = true;
    document.getElementById('btn-gemini-grammar').disabled = true;
    document.getElementById('btn-download-grammar').disabled = true;
  }
}

// Copy buttons
document.getElementById('btn-copy-vocab').addEventListener('click', async () => {
  const prompt = buildVocabPrompt(currentDocId);
  if (!prompt) return;
  await navigator.clipboard.writeText(prompt);
  flashButton('btn-copy-vocab', 'Copied!');
});

document.getElementById('btn-copy-grammar').addEventListener('click', async () => {
  const prompt = buildGrammarPrompt(currentDocId);
  if (!prompt) return;
  await navigator.clipboard.writeText(prompt);
  flashButton('btn-copy-grammar', 'Copied!');
});

// Gemini buttons — copy to clipboard then open Gemini
document.getElementById('btn-gemini-vocab').addEventListener('click', async () => {
  const prompt = buildVocabPrompt(currentDocId);
  if (!prompt) return;
  await navigator.clipboard.writeText(prompt);
  window.open('https://gemini.google.com/app', '_blank');
});

document.getElementById('btn-gemini-grammar').addEventListener('click', async () => {
  const prompt = buildGrammarPrompt(currentDocId);
  if (!prompt) return;
  await navigator.clipboard.writeText(prompt);
  window.open('https://gemini.google.com/app', '_blank');
});

// Download buttons
document.getElementById('btn-download-vocab').addEventListener('click', () => {
  const prompt = buildVocabPrompt(currentDocId);
  if (!prompt) return;
  downloadText(prompt, 'vocabulary-prompt.txt');
});

document.getElementById('btn-download-grammar').addEventListener('click', () => {
  const prompt = buildGrammarPrompt(currentDocId);
  if (!prompt) return;
  downloadText(prompt, 'grammar-prompt.txt');
});

// ===== UTILITIES =====
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function flashButton(id, label) {
  const btn = document.getElementById(id);
  const original = btn.textContent;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
}

// ===== SETTINGS =====
document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('btn-settings-reader').addEventListener('click', openSettings);

function openSettings() {
  document.getElementById('setting-vocab-template').value = getVocabTemplate();
  document.getElementById('setting-grammar-template').value = getGrammarTemplate();
  document.getElementById('settings-status').textContent = '';
  showView('settings');
}

document.getElementById('btn-back-from-settings').addEventListener('click', () => {
  showView('library');
  renderLibrary();
});

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  state.settings.vocabTemplate = document.getElementById('setting-vocab-template').value;
  state.settings.grammarTemplate = document.getElementById('setting-grammar-template').value;
  await saveData();
  document.getElementById('settings-status').textContent = 'Saved!';
  setTimeout(() => { document.getElementById('settings-status').textContent = ''; }, 2000);
});

document.getElementById('btn-reset-settings').addEventListener('click', () => {
  document.getElementById('setting-vocab-template').value = DEFAULT_VOCAB_TEMPLATE;
  document.getElementById('setting-grammar-template').value = DEFAULT_GRAMMAR_TEMPLATE;
  document.getElementById('settings-status').textContent = 'Reset to defaults (click Save to apply)';
});

// ===== HELP MODAL =====
document.getElementById('btn-help-library').addEventListener('click', openHelp);
document.getElementById('btn-help').addEventListener('click', openHelp);
document.getElementById('btn-close-help').addEventListener('click', closeHelp);
document.getElementById('help-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeHelp();
});

function openHelp() {
  document.getElementById('help-modal').classList.remove('hidden');
}
function closeHelp() {
  document.getElementById('help-modal').classList.add('hidden');
}

// ===== INIT =====
(async () => {
  // Check if user is authenticated
  const userRes = await fetch('/api/user');
  if (userRes.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  const user = await userRes.json();
  document.getElementById('user-name').textContent = user.name;

  await loadData();
  renderLibrary();
  showView('library');
})();
