// Scholarr - Frontend Application Logic

// App State
const state = {
  currentTab: 'tutor',
  currentCourseId: '',
  currentTopicId: '',
  courses: [],
  topics: [],
  notes: [],
  docs: [],
  selectedNoteId: null,
  selectedCourseIdForDetail: null,
  profile: null,
  llmConfig: null,
  onlyBookmarked: false,
  isSendingChat: false,
};

// --- TOAST NOTIFICATION COMPONENT ---
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast-item pointer-events-auto p-3.5 rounded-2xl text-xs flex items-center space-x-3 shadow-2xl backdrop-blur-md border';

  let iconName = 'info';
  let borderBgClass = 'bg-slate-900/95 border-slate-700/80 text-slate-100';

  if (type === 'success') {
    iconName = 'check-circle-2';
    borderBgClass = 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100 shadow-emerald-950/50';
  } else if (type === 'error') {
    iconName = 'alert-circle';
    borderBgClass = 'bg-rose-950/90 border-rose-500/50 text-rose-100 shadow-rose-950/50';
  } else if (type === 'warning') {
    iconName = 'alert-triangle';
    borderBgClass = 'bg-amber-950/90 border-amber-500/50 text-amber-100 shadow-amber-950/50';
  }

  toast.className += ` ${borderBgClass}`;
  toast.innerHTML = `
    <i data-lucide="${iconName}" class="w-4 h-4 shrink-0"></i>
    <span class="flex-1 font-medium leading-relaxed">${escapeHtml(message)}</span>
    <button class="toast-close opacity-60 hover:opacity-100 transition">
      <i data-lucide="x" class="w-3.5 h-3.5"></i>
    </button>
  `;

  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  const removeToast = () => {
    toast.classList.add('toast-leave');
    setTimeout(() => toast.remove(), 250);
  };

  toast.querySelector('.toast-close').addEventListener('click', removeToast);
  setTimeout(removeToast, duration);
}

// --- CONFIRMATION MODAL COMPONENT ---
function showConfirmDialog(title, message, options = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('btnConfirmOk');
    const cancelBtn = document.getElementById('btnConfirmCancel');

    if (!modal) {
      resolve(true);
      return;
    }

    titleEl.textContent = title || 'Confirm Action';
    msgEl.textContent = message || 'Are you sure you want to proceed?';
    okBtn.textContent = options.confirmText || 'Confirm';

    if (options.isDangerous === false) {
      okBtn.className = 'px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition';
    } else {
      okBtn.className = 'px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/20 transition';
    }

    modal.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();

    const onConfirm = () => {
      cleanup();
      modal.classList.add('hidden');
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      modal.classList.add('hidden');
      resolve(false);
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };

    okBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// --- URL ROUTING & HISTORY SYNCHRONIZATION ---
function updateUrlParams() {
  const params = new URLSearchParams();
  if (state.currentTab && state.currentTab !== 'tutor') {
    params.set('tab', state.currentTab);
  }
  if (state.currentCourseId) {
    params.set('course_id', state.currentCourseId);
  }
  if (state.currentTopicId) {
    params.set('topic_id', state.currentTopicId);
  }
  if (state.selectedNoteId && state.currentTab === 'notes') {
    params.set('note_id', state.selectedNoteId);
  }

  const queryString = params.toString();
  const newRelativePathQuery = window.location.pathname + (queryString ? '?' + queryString : '');
  window.history.replaceState(null, '', newRelativePathQuery);
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab') || 'tutor';
  const courseId = params.get('course_id') || '';
  const topicId = params.get('topic_id') || '';
  const noteId = params.get('note_id') || null;

  return { tab, courseId, topicId, noteId };
}

// Handle Browser Back / Forward buttons
window.addEventListener('popstate', async () => {
  const { tab, courseId, topicId, noteId } = parseUrlParams();
  state.currentTab = tab;
  state.currentCourseId = courseId;
  state.currentTopicId = topicId;
  state.selectedNoteId = noteId;

  document.getElementById('globalCourseSelect').value = courseId;
  await loadTopicsForCourse(courseId);
  document.getElementById('globalTopicSelect').value = topicId;

  switchTab(tab, false);
  await loadChatHistory();
  if (tab === 'notes') await loadNotes();
});

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  if (window.lucide) {
    lucide.createIcons();
  }

  const initialParams = parseUrlParams();
  state.currentTab = initialParams.tab;
  state.currentCourseId = initialParams.courseId;
  state.currentTopicId = initialParams.topicId;
  state.selectedNoteId = initialParams.noteId;

  await loadProfile();
  await loadLlmConfig();
  await loadCourses();

  if (state.currentCourseId) {
    document.getElementById('globalCourseSelect').value = state.currentCourseId;
    await loadTopicsForCourse(state.currentCourseId);
    if (state.currentTopicId) {
      document.getElementById('globalTopicSelect').value = state.currentTopicId;
    }
  }

  switchTab(state.currentTab, false);
  await loadNotes();
  await loadChatHistory();
  await loadOverviewStats();
});

// --- UTILITY: DEBOUNCE ---
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// --- TAB SWITCHER ---
function switchTab(tabName, updateUrl = true) {
  state.currentTab = tabName;
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.className = 'tab-btn w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-all';
  });
  document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
    btn.className = 'mobile-tab-btn flex flex-col items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition';
  });

  const activePane = document.getElementById(`tab-${tabName}`);
  const activeBtn = document.getElementById(`tabBtn-${tabName}`);
  const activeMobileBtn = document.getElementById(`mobileTabBtn-${tabName}`);

  if (activePane) activePane.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.className = 'tab-btn w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  }
  if (activeMobileBtn) {
    activeMobileBtn.className = 'mobile-tab-btn flex flex-col items-center justify-center p-1.5 rounded-lg text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 transition';
  }

  if (tabName === 'courses') {
    renderCoursesHub();
  } else if (tabName === 'notes') {
    loadNotes();
  } else if (tabName === 'graph') {
    renderKnowledgeGraph();
  } else if (tabName === 'flashcards') {
    renderFlashcardsView();
  } else if (tabName === 'docs') {
    loadDocs();
  }

  if (updateUrl) {
    updateUrlParams();
  }

  if (window.lucide) lucide.createIcons();
}

window.addEventListener('resize', debounce(() => {
  if (state.currentTab === 'graph') {
    renderKnowledgeGraph();
  }
}, 250));

// --- MODAL UTILS ---
function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('hidden');
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- SAFE SELF-HEALING LATEX + MARKDOWN RENDERER ---
function renderMarkdownWithLatex(text, targetElement) {
  if (!text) {
    targetElement.innerHTML = '';
    return;
  }

  let processed = text;

  // 1. Fix common LLM malformed nested dollar injections (e.g. `\delta$\tau$` -> `\delta(\tau)`, `x$\tau$` -> `x(\tau)`, `u$\sigma$` -> `u(\sigma)`)
  processed = processed.replace(/([\\a-zA-Z0-9_]+)\$([\\a-zA-Z0-9_]+)\$/g, (match, prefix, inner) => {
    if (prefix.startsWith('\\')) {
      return `${prefix}(${inner.replace(/\\/g, '')})`;
    }
    return `${prefix}(${inner.replace(/\\/g, '')})`;
  });

  // 2. Normalize standard LaTeX wrappers
  // \[ ... \] -> $$ ... $$
  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (match, eq) => `\n$$\n${eq.trim()}\n$$\n`);
  // \( ... \) -> $ ... $
  processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (match, eq) => `$${eq.trim()}$`);

  // 3. Normalize standalone bracket blocks: [ \n math \n ] -> $$ math $$
  processed = processed.replace(/(?:^|\n)\s*\[\s*\n([\s\S]*?)\n\s*\]\s*(?=\n|$)/g, (match, eq) => {
    return `\n$$\n${eq.trim()}\n$$\n`;
  });

  // 4. Auto-wrap unwrapped standalone equation lines containing LaTeX math commands
  const lines = processed.split('\n');
  const mathIndicators = [
    '\\int', '\\sum', '\\frac', '\\boxed', '\\begin', '\\lim', '\\sqrt', '\\oint',
    '\\partial', '\\infty', '\\mathbb', '\\mathcal', '\\mathbf', '\\hat', '\\bar', '\\tilde',
    '\\delta', '\\tau', '\\omega', '\\sigma', '\\theta', '\\alpha', '\\beta', '\\gamma',
    '\\rightarrow', '\\leq', '\\geq', '\\neq', '\\approx', '\\times', '\\cdot'
  ];

  let inCodeBlock = false;
  let inMathBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    if (line.startsWith('$$')) {
      inMathBlock = !inMathBlock;
      continue;
    }
    if (inMathBlock) continue;

    // Check if line is an unwrapped math equation
    if (
      !line.startsWith('$') &&
      !line.startsWith('#') &&
      !line.startsWith('- ') &&
      !line.startsWith('* ') &&
      !line.startsWith('> ') &&
      line.length > 3
    ) {
      const containsMathCommand = mathIndicators.some(cmd => line.includes(cmd));
      const looksLikeEquation = (
        containsMathCommand ||
        (/^[a-zA-Z]\([a-zA-Z0-9,\s+-]*\)\s*=/.test(line) && line.includes('\\')) ||
        line.startsWith('\\boxed')
      );

      if (looksLikeEquation && !line.includes('$$')) {
        const cleanEq = line.replace(/\$/g, '');
        lines[i] = `\n$$\n${cleanEq}\n$$\n`;
      }
    }
  }
  processed = lines.join('\n');

  // 5. Tokenize Math Blocks and Inlines to prevent Marked.js from damaging LaTeX characters (_, *, \, ^)
  const mathTokens = [];

  // Replace Block Math $$ ... $$
  processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    let cleanMath = math.replace(/\$/g, '').trim();
    cleanMath = cleanMath.replace(/,([a-zA-Z]+)/g, '\\,$1');

    const placeholder = `%%KATEX_BLOCK_${mathTokens.length}%%`;
    mathTokens.push({ isBlock: true, math: cleanMath });
    return placeholder;
  });

  // Replace Inline Math $ ... $
  processed = processed.replace(/\$((?:[^\$\\]|\\.)+)\$/g, (match, math) => {
    let cleanMath = math.trim();
    const placeholder = `%%KATEX_INLINE_${mathTokens.length}%%`;
    mathTokens.push({ isBlock: false, math: cleanMath });
    return placeholder;
  });

  // 6. Parse Obsidian Callouts (> [!THEOREM], > [!PROOF], > [!DEFINITION], > [!NOTE], > [!WARNING], > [!EXAMPLE])
  processed = processed.replace(/^>\s*\[!([a-zA-Z]+)\]\s*([^\n]*)\n((?:^>.*(?:\n|$))*)/gm, (match, type, title, body) => {
    const calloutType = type.toLowerCase();
    const cleanTitle = title.trim() || type.toUpperCase();
    const cleanBody = body.replace(/^>\s?/gm, '').trim();

    const icons = {
      theorem: '💡',
      proof: '🎓',
      definition: '📖',
      example: '🎯',
      note: '📝',
      warning: '⚠️'
    };
    const icon = icons[calloutType] || '📌';

    return `\n<div class="callout callout-${calloutType}">
  <div class="callout-title"><span>${icon}</span><span>${escapeHtml(cleanTitle)}</span></div>
  <div class="callout-content">\n\n${cleanBody}\n\n</div>
</div>\n`;
  });

  // 7. Parse Notion Toggle Derivation Lists (<toggle title="Derivation"> ... </toggle>)
  processed = processed.replace(/<toggle\s+title="([^"]+)">([\s\S]*?)<\/toggle>/g, (match, title, body) => {
    return `\n<details class="notion-toggle">
  <summary><i data-lucide="chevron-right" class="w-4 h-4 text-cyan-400"></i> ${escapeHtml(title)}</summary>
  <div class="toggle-body">\n\n${body.trim()}\n\n</div>
</details>\n`;
  });

  // 8. Parse Obsidian-style Bidirectional Wiki-Links [[Concept Name]]
  processed = processed.replace(/\[\[([^\]]+)\]\]/g, (match, linkText) => {
    const cleanText = linkText.trim();
    return `<a class="wiki-link" onclick="onWikiLinkClick('${escapeHtml(cleanText)}')" title="Jump to concept: ${escapeHtml(cleanText)}">🔗 [[${escapeHtml(cleanText)}]]</a>`;
  });

  // 9. Parse Markdown safely with marked.js
  marked.setOptions({
    gfm: true,
    breaks: true,
    highlight: function(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (err) {}
      }
      return hljs.highlightAuto(code).value;
    }
  });

  let rawHtml = marked.parse(processed);

  // 10. Render all Math Tokens with KaTeX
  for (let i = 0; i < mathTokens.length; i++) {
    const { isBlock, math } = mathTokens[i];
    const blockPlaceholder = `%%KATEX_BLOCK_${i}%%`;
    const inlinePlaceholder = `%%KATEX_INLINE_${i}%%`;

    let renderedMath = '';
    if (window.katex) {
      try {
        renderedMath = katex.renderToString(math, {
          displayMode: isBlock,
          throwOnError: false,
          output: 'htmlAndMathml',
          strict: false
        });
      } catch (err) {
        renderedMath = `<span class="katex-fallback font-mono text-emerald-400 text-xs">${escapeHtml(math)}</span>`;
      }
    } else {
      renderedMath = isBlock ? `<pre class="my-2 p-2 bg-slate-900 rounded">$$${math}$$</pre>` : `<code>$${math}$</code>`;
    }

    if (isBlock) {
      const copyBtnHtml = `<button onclick="copyLatexFormula(this)" data-latex="${encodeURIComponent(math)}" class="copy-latex-btn px-2 py-1 bg-slate-800/90 hover:bg-emerald-700/80 border border-slate-700 hover:border-emerald-500 rounded-lg text-[10px] text-slate-300 hover:text-white flex items-center space-x-1 shadow-md" title="Copy LaTeX code"><i data-lucide="copy" class="w-3 h-3"></i><span>LaTeX</span></button>`;
      const blockHtml = `<div class="katex-display-container my-3 overflow-x-auto relative group">${copyBtnHtml}${renderedMath}</div>`;
      rawHtml = rawHtml.replace(new RegExp(`<p>\\s*${blockPlaceholder}\\s*<\\/p>`, 'g'), blockHtml);
      rawHtml = rawHtml.replace(new RegExp(blockPlaceholder, 'g'), blockHtml);
    } else {
      rawHtml = rawHtml.replace(new RegExp(inlinePlaceholder, 'g'), renderedMath);
    }
  }

  targetElement.innerHTML = rawHtml;

  // 11. Enhance Python / Manim code blocks with Interactive Execution & Visualization Widgets
  enhancePythonCodeBlocks(targetElement);

  if (window.lucide) lucide.createIcons();
}

// --- INTERACTIVE PYTHON & MANIM SANDBOX RUNNER ---
function enhancePythonCodeBlocks(parentElement) {
  const codeBlocks = parentElement.querySelectorAll('pre > code');
  codeBlocks.forEach((codeEl) => {
    const rawCode = codeEl.textContent.trim();
    const isPython = codeEl.classList.contains('language-python')
      || rawCode.includes('import matplotlib')
      || rawCode.includes('import numpy')
      || rawCode.includes('import scipy')
      || rawCode.includes('from manim import')
      || rawCode.includes('plt.plot')
      || rawCode.includes('plt.figure')
      || rawCode.includes('def ') && rawCode.includes('return');

    if (!isPython) return;

    const preEl = codeEl.parentElement;
    if (preEl.parentElement.classList.contains('code-studio-wrapper')) return;

    const isManim = rawCode.includes('from manim import') || (rawCode.includes('class ') && rawCode.includes('Scene):'));
    const runnerId = 'runner-' + Math.random().toString(36).substring(2, 9);

    const widgetHtml = `
      <div id="${runnerId}" class="code-studio-wrapper my-4 rounded-2xl border border-slate-700/80 bg-slate-900/90 shadow-2xl overflow-hidden backdrop-blur-md">
        <!-- Studio Header -->
        <div class="px-4 py-2.5 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center space-x-2">
            <span class="text-sm">${isManim ? '🎬' : '🐍'}</span>
            <span class="text-xs font-semibold text-slate-200 tracking-wide font-mono">${isManim ? '3Blue1Brown Animation Studio (Manim)' : 'Interactive Python & Plot Sandbox'}</span>
          </div>
          <div class="flex items-center space-x-2">
            <button onclick="toggleCodeEdit('${runnerId}')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-medium flex items-center space-x-1 border border-slate-700 transition">
              <i data-lucide="edit-3" class="w-3 h-3"></i>
              <span>Edit Code</span>
            </button>
            <button onclick="runSandboxCode('${runnerId}')" class="btn-run-sandbox px-3.5 py-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white text-[11px] font-semibold flex items-center space-x-1.5 shadow-md shadow-emerald-500/20 active:scale-95 transition">
              <i data-lucide="play" class="w-3 h-3 fill-current"></i>
              <span>${isManim ? 'Render 3B1B Animation' : 'Run & Simulate Plot'}</span>
            </button>
          </div>
        </div>

        <!-- Editable Code Area (Hidden by default, shown when user clicks Edit) -->
        <div class="code-edit-container hidden p-3 bg-slate-950 border-b border-slate-800">
          <textarea class="code-editor w-full h-48 bg-slate-900/90 text-emerald-300 font-mono text-xs p-3 rounded-xl border border-slate-700 focus:outline-none focus:border-emerald-500 resize-y" spellcheck="false">${escapeHtml(rawCode)}</textarea>
        </div>

        <!-- Static Highlighted Code Display -->
        <div class="code-display p-3 overflow-x-auto text-xs bg-slate-950/40">
          ${preEl.outerHTML}
        </div>

        <!-- Output Visualization & Console Area -->
        <div class="sandbox-output hidden border-t border-slate-800/90 bg-slate-950/90 p-4 space-y-3">
          <div class="flex items-center justify-between text-xs pb-1 border-b border-slate-800/60">
            <span class="font-semibold text-slate-300 flex items-center space-x-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Execution Output & Visual Canvas</span>
            </span>
            <span class="exec-time text-[10px] text-slate-500 font-mono"></span>
          </div>

          <!-- Media Visualizer (Plots & Animations) -->
          <div class="media-container space-y-3"></div>

          <!-- Stdout / Stderr Console -->
          <div class="console-container hidden rounded-xl bg-slate-900 border border-slate-800 p-3 font-mono text-[11px] space-y-1">
            <div class="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Console Output</div>
            <pre class="stdout text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto"></pre>
            <pre class="stderr text-rose-400 whitespace-pre-wrap max-h-48 overflow-y-auto hidden"></pre>
          </div>
        </div>
      </div>
    `;

    preEl.outerHTML = widgetHtml;

    // Automatically trigger code execution immediately upon arrival
    setTimeout(() => {
      runSandboxCode(runnerId);
    }, 150);
  });
}

function toggleCodeEdit(runnerId) {
  const runner = document.getElementById(runnerId);
  if (!runner) return;
  const editContainer = runner.querySelector('.code-edit-container');
  const codeDisplay = runner.querySelector('.code-display');
  if (editContainer) {
    const isHidden = editContainer.classList.contains('hidden');
    if (isHidden) {
      editContainer.classList.remove('hidden');
      if (codeDisplay) codeDisplay.classList.add('hidden');
    } else {
      editContainer.classList.add('hidden');
      if (codeDisplay) codeDisplay.classList.remove('hidden');
    }
  }
}

async function runSandboxCode(runnerId) {
  const runner = document.getElementById(runnerId);
  if (!runner) return;

  const editor = runner.querySelector('.code-editor');
  const code = editor ? editor.value.trim() : '';
  if (!code) return;

  const btn = runner.querySelector('.btn-run-sandbox');
  const outputArea = runner.querySelector('.sandbox-output');
  const mediaContainer = runner.querySelector('.media-container');
  const consoleContainer = runner.querySelector('.console-container');
  const stdoutEl = runner.querySelector('.stdout');
  const stderrEl = runner.querySelector('.stderr');
  const timeEl = runner.querySelector('.exec-time');

  btn.disabled = true;
  const originalBtnHtml = btn.innerHTML;
  btn.innerHTML = `<i data-lucide="loader-2" class="w-3 h-3 animate-spin"></i><span>Executing Sandbox...</span>`;
  if (window.lucide) lucide.createIcons();

  outputArea.classList.remove('hidden');
  mediaContainer.innerHTML = `
    <div class="p-6 text-center text-slate-400 text-xs flex flex-col items-center justify-center space-y-2 bg-slate-900/50 rounded-xl border border-slate-800">
      <i data-lucide="loader" class="w-6 h-6 animate-spin text-emerald-400"></i>
      <span>Executing Python sandbox, compiling equations & rendering visuals...</span>
    </div>
  `;
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch('/api/execute/python', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const json = await res.json();

    if (json.success && json.data) {
      const { stdout, stderr, images_base64, videos_base64, execution_time_ms } = json.data;

      timeEl.textContent = `Completed in ${execution_time_ms}ms`;
      mediaContainer.innerHTML = '';

      // 1. Render Generated High-Res Plots / Diagrams
      if (images_base64 && images_base64.length > 0) {
        images_base64.forEach((imgSrc, idx) => {
          mediaContainer.innerHTML += `
            <div class="plot-card rounded-xl bg-slate-950 p-2 border border-slate-800 shadow-lg space-y-2">
              <div class="flex items-center justify-between px-2 pt-1 text-[11px] text-slate-400">
                <span class="font-medium flex items-center space-x-1">
                  <span>📊</span>
                  <span>Figure ${idx + 1} (Matplotlib / Scientific Plot)</span>
                </span>
                <a href="${imgSrc}" download="scholarr_plot_${idx + 1}.png" class="text-cyan-400 hover:text-cyan-300 flex items-center space-x-1 text-[10px]">
                  <i data-lucide="download" class="w-3 h-3"></i>
                  <span>Save Image</span>
                </a>
              </div>
              <img src="${imgSrc}" alt="Rendered Plot" class="w-full rounded-lg border border-slate-800/80 bg-white max-h-[480px] object-contain mx-auto">
            </div>
          `;
        });
      }

      // 2. Render Generated 3Blue1Brown (Manim) Video Animations
      if (videos_base64 && videos_base64.length > 0) {
        videos_base64.forEach((vidSrc, idx) => {
          mediaContainer.innerHTML += `
            <div class="video-card rounded-xl bg-slate-950 p-2 border border-slate-800 shadow-lg space-y-2">
              <div class="flex items-center justify-between px-2 pt-1 text-[11px] text-slate-400">
                <span class="font-medium flex items-center space-x-1">
                  <span>🎬</span>
                  <span>3Blue1Brown Animation Clip ${idx + 1} (Manim)</span>
                </span>
                <a href="${vidSrc}" download="scholarr_animation_${idx + 1}.mp4" class="text-cyan-400 hover:text-cyan-300 flex items-center space-x-1 text-[10px]">
                  <i data-lucide="download" class="w-3 h-3"></i>
                  <span>Save MP4</span>
                </a>
              </div>
              <video controls autoplay loop class="w-full rounded-lg border border-slate-800 max-h-[480px] bg-black mx-auto">
                <source src="${vidSrc}" type="video/mp4">
                Your browser does not support HTML5 video.
              </video>
            </div>
          `;
        });
      }

      if ((!images_base64 || images_base64.length === 0) && (!videos_base64 || videos_base64.length === 0)) {
        if (!stdout && !stderr) {
          mediaContainer.innerHTML = `
            <div class="p-3 text-center text-xs text-slate-400 bg-slate-900/60 rounded-xl border border-slate-800">
              Code executed successfully with code 0 (no graphical figures or print statements produced).
            </div>
          `;
        }
      }

      // 3. Render Console Output
      if (stdout || stderr) {
        consoleContainer.classList.remove('hidden');
        if (stdout) {
          stdoutEl.textContent = stdout;
          stdoutEl.classList.remove('hidden');
        } else {
          stdoutEl.classList.add('hidden');
        }

        if (stderr) {
          stderrEl.innerHTML = `
            <div class="space-y-2">
              <pre class="text-rose-400 whitespace-pre-wrap">${escapeHtml(stderr)}</pre>
              <div class="flex justify-end pt-1">
                <button onclick="autoFixCodeWithAI('${runnerId}')" class="btn-auto-fix px-3 py-1 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border border-rose-500/40 text-xs font-semibold flex items-center space-x-1.5 transition active:scale-95">
                  <i data-lucide="sparkles" class="w-3.5 h-3.5 text-amber-300"></i>
                  <span>Auto-Fix Code with AI</span>
                </button>
              </div>
            </div>
          `;
          stderrEl.classList.remove('hidden');
        } else {
          stderrEl.classList.add('hidden');
        }
      } else {
        consoleContainer.classList.add('hidden');
      }

      if (window.lucide) lucide.createIcons();
      showToast('Execution finished!', 'success', 2000);
    } else {
      mediaContainer.innerHTML = `
        <div class="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs space-y-1">
          <div class="font-bold flex items-center space-x-1.5">
            <span>⚠️</span>
            <span>Execution Error:</span>
          </div>
          <p class="font-mono text-[11px]">${escapeHtml(json.error || 'Failed to execute script.')}</p>
        </div>
      `;
      showToast('Execution error', 'error');
    }
  } catch (err) {
    mediaContainer.innerHTML = `
      <div class="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-200 text-xs">
        <p class="font-bold">Sandbox Connection Error:</p>
        <p class="font-mono text-[11px]">${escapeHtml(err.message)}</p>
      </div>
    `;
    showToast('Failed to run code: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
    if (window.lucide) lucide.createIcons();
  }
}

async function autoFixCodeWithAI(runnerId) {
  const runner = document.getElementById(runnerId);
  if (!runner) return;
  const editor = runner.querySelector('.code-editor');
  const code = editor ? editor.value.trim() : '';
  const stderrPre = runner.querySelector('.stderr pre');
  const stderr = stderrPre ? stderrPre.textContent.trim() : '';
  const mediaContainer = runner.querySelector('.media-container');
  const fixBtn = runner.querySelector('.btn-auto-fix') || event?.currentTarget;

  if (!code || !stderr) {
    showToast('No error or code found to fix', 'error');
    return;
  }

  // Update button state to loading
  let originalBtnHtml = '';
  if (fixBtn) {
    fixBtn.disabled = true;
    originalBtnHtml = fixBtn.innerHTML;
    fixBtn.innerHTML = `<i data-lucide="loader-2" class="w-3.5 h-3.5 animate-spin text-amber-300"></i><span>AI is Repairing Code...</span>`;
    if (window.lucide) lucide.createIcons();
  }

  // Display persistent live repairing banner
  if (mediaContainer) {
    mediaContainer.innerHTML = `
      <div class="p-5 rounded-2xl bg-gradient-to-r from-purple-950/70 via-slate-900 to-indigo-950/70 border border-purple-500/40 text-purple-200 text-xs shadow-xl space-y-3 animate-pulse-subtle">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-2.5">
            <div class="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-500/50 flex items-center justify-center shrink-0">
              <i data-lucide="sparkles" class="w-4 h-4 text-amber-300 animate-spin"></i>
            </div>
            <div>
              <div class="font-bold text-slate-100 text-[13px] flex items-center space-x-1.5">
                <span>AI Automated Repair Active</span>
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              </div>
              <p class="text-[11px] text-purple-300/80">Analyzing runtime traceback, patching function signatures & recompiling in sandbox...</p>
            </div>
          </div>
        </div>
        <div class="w-full bg-purple-950/60 rounded-full h-1.5 overflow-hidden border border-purple-800/40">
          <div class="bg-gradient-to-r from-purple-500 to-emerald-400 h-full rounded-full animate-pulse" style="width: 100%"></div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  showToast('AI is debugging and repairing code...', 'info', 4000);

  try {
    const res = await fetch('/api/execute/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, stderr })
    });
    const json = await res.json();
    if (json.success && json.data && json.data.fixed_code) {
      const fixedCode = json.data.fixed_code.trim();
      editor.value = fixedCode;
      const codeDisplay = runner.querySelector('.code-display pre code');
      if (codeDisplay) {
        codeDisplay.textContent = fixedCode;
        if (window.hljs) hljs.highlightElement(codeDisplay);
      }
      showToast('Code repaired and saved to history! Re-running...', 'success', 3000);
      await runSandboxCode(runnerId);
    } else {
      if (mediaContainer) {
        mediaContainer.innerHTML = `
          <div class="p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-200 text-xs">
            <span class="font-bold">⚠️ Repair Unsuccessful:</span> ${escapeHtml(json.error || 'No valid code fix returned')}
          </div>
        `;
      }
      showToast('AI repair failed: ' + (json.error || 'No fix returned'), 'error');
    }
  } catch (err) {
    if (mediaContainer) {
      mediaContainer.innerHTML = `
        <div class="p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-200 text-xs">
          <span class="font-bold">⚠️ Connection Error:</span> ${escapeHtml(err.message)}
        </div>
      `;
    }
    showToast('Failed to connect to AI debugger: ' + err.message, 'error');
  } finally {
    if (fixBtn) {
      fixBtn.disabled = false;
      fixBtn.innerHTML = originalBtnHtml;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// Copy raw LaTeX formula
function copyLatexFormula(btn) {
  const latex = decodeURIComponent(btn.getAttribute('data-latex') || '');
  if (!latex) return;
  navigator.clipboard.writeText(latex).then(() => {
    showToast('LaTeX formula copied to clipboard!', 'success', 2000);
  }).catch(() => {
    showToast('Failed to copy LaTeX', 'error');
  });
}

// --- USER PROFILE & PERSONA ---
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    const json = await res.json();
    if (json.success && json.data) {
      state.profile = json.data;
      updatePersonaUI(json.data);
    }
  } catch (err) {
    console.error('Failed to load profile:', err);
  }
}

function updatePersonaUI(p) {
  const icons = {
    socratic: '🦉',
    eli5: '💡',
    rigorous: '🎓',
    exam_prep: '🎯',
    concise: '⚡'
  };
  const icon = icons[p.tone] || '🦉';
  document.getElementById('personaIcon').textContent = icon;
  document.getElementById('personaName').textContent = p.tone.charAt(0).toUpperCase() + p.tone.slice(1);
  
  const levelLabels = { beginner: 'BEG', intermediate: 'INT', advanced: 'ADV', expert: 'EXP' };
  document.getElementById('personaLevel').textContent = levelLabels[p.knowledge_level] || 'INT';

  // Populate Persona Modal Inputs
  document.getElementById('profName').value = p.name || '';
  document.getElementById('profTone').value = p.tone || 'socratic';
  document.getElementById('profLevel').value = p.knowledge_level || 'intermediate';
  document.getElementById('profMathDetail').value = p.math_detail_level || 'high';
  if (document.getElementById('profQuizDifficulty')) {
    document.getElementById('profQuizDifficulty').value = p.quiz_difficulty || 'adaptive';
  }
  document.getElementById('profGoals').value = p.learning_goals || '';
  document.getElementById('profCustom').value = p.custom_instructions || '';
}

async function saveProfileSettings() {
  const payload = {
    id: 'default',
    name: document.getElementById('profName').value,
    tone: document.getElementById('profTone').value,
    knowledge_level: document.getElementById('profLevel').value,
    math_detail_level: document.getElementById('profMathDetail').value,
    quiz_difficulty: document.getElementById('profQuizDifficulty') ? document.getElementById('profQuizDifficulty').value : 'adaptive',
    learning_goals: document.getElementById('profGoals').value,
    custom_instructions: document.getElementById('profCustom').value,
    updated_at: new Date().toISOString()
  };

  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success && json.data) {
      state.profile = json.data;
      updatePersonaUI(json.data);
      closeModal('personaModal');
      showToast('Learning persona saved successfully!', 'success');
    } else {
      showToast(json.error || 'Failed to save persona profile', 'error');
    }
  } catch (err) {
    showToast('Failed to save persona profile: ' + err.message, 'error');
  }
}

// --- LLM CONFIGURATION ---
async function loadLlmConfig() {
  try {
    const res = await fetch('/api/settings/llm');
    const json = await res.json();
    if (json.success && json.data) {
      state.llmConfig = json.data;
      document.getElementById('llmProvider').value = json.data.provider || 'openrouter';
      document.getElementById('llmApiKey').value = json.data.api_key || '';
      document.getElementById('llmBaseUrl').value = json.data.base_url || 'https://openrouter.ai/api/v1';
      document.getElementById('llmEmbeddingBaseUrl').value = json.data.embedding_base_url || '';
      document.getElementById('llmEmbeddingApiKey').value = json.data.embedding_api_key || '';
      document.getElementById('llmModel').value = json.data.model || 'poolside/laguna-s-2.1:free';
      document.getElementById('llmEmbeddingModel').value = json.data.embedding_model || 'liquid/lfm-2.5-embedding-350m:free';
      document.getElementById('llmTemp').value = json.data.temperature;
      document.getElementById('llmMaxTokens').value = json.data.max_tokens;
    }
  } catch (err) {
    console.error('Failed to load LLM config:', err);
  }
}

function onLlmProviderPresetChange() {
  const provider = document.getElementById('llmProvider').value;
  const presets = {
    openrouter: {
      url: 'https://openrouter.ai/api/v1',
      model: 'poolside/laguna-s-2.1:free',
      embedding: 'liquid/lfm-2.5-embedding-350m:free'
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-2.5-flash',
      embedding: 'text-embedding-004'
    },
    openai: {
      url: 'https://api.openai.com/v1/',
      model: 'gpt-4o',
      embedding: 'text-embedding-3-small'
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/',
      model: 'llama-3.3-70b-versatile',
      embedding: 'liquid/lfm-2.5-embedding-350m:free'
    },
    ollama: {
      url: 'http://localhost:11434/v1/',
      model: 'llama3.2',
      embedding: 'nomic-embed-text'
    },
    anthropic: {
      url: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-3.5-sonnet',
      embedding: 'liquid/lfm-2.5-embedding-350m:free'
    },
    custom: {
      url: '',
      model: '',
      embedding: ''
    }
  };

  if (presets[provider]) {
    if (presets[provider].url) document.getElementById('llmBaseUrl').value = presets[provider].url;
    if (presets[provider].model) document.getElementById('llmModel').value = presets[provider].model;
    if (presets[provider].embedding) document.getElementById('llmEmbeddingModel').value = presets[provider].embedding;
  }
}

async function saveLlmSettings() {
  const payload = {
    provider: document.getElementById('llmProvider').value,
    api_key: document.getElementById('llmApiKey').value,
    base_url: document.getElementById('llmBaseUrl').value,
    embedding_base_url: document.getElementById('llmEmbeddingBaseUrl').value,
    embedding_api_key: document.getElementById('llmEmbeddingApiKey').value,
    model: document.getElementById('llmModel').value,
    embedding_model: document.getElementById('llmEmbeddingModel').value,
    temperature: parseFloat(document.getElementById('llmTemp').value) || 0.7,
    max_tokens: parseInt(document.getElementById('llmMaxTokens').value) || 4096
  };

  try {
    const res = await fetch('/api/settings/llm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) {
      showToast('LLM settings saved successfully!', 'success');
      closeModal('llmModal');
      await loadLlmConfig();
    } else {
      showToast('Error saving LLM settings: ' + json.error, 'error');
    }
  } catch (err) {
    showToast('Failed to save LLM settings: ' + err.message, 'error');
  }
}

async function testLlmConnection() {
  const statusEl = document.getElementById('llmTestStatus');
  statusEl.classList.remove('hidden');
  statusEl.className = 'p-3 rounded-xl text-xs bg-slate-800 text-purple-300 animate-pulse-subtle border border-purple-800/50';
  statusEl.textContent = 'Testing connection for chat & embedding models...';

  const payload = {
    provider: document.getElementById('llmProvider').value,
    api_key: document.getElementById('llmApiKey').value,
    base_url: document.getElementById('llmBaseUrl').value,
    embedding_base_url: document.getElementById('llmEmbeddingBaseUrl').value,
    embedding_api_key: document.getElementById('llmEmbeddingApiKey').value,
    model: document.getElementById('llmModel').value,
    embedding_model: document.getElementById('llmEmbeddingModel').value,
    temperature: 0.7,
    max_tokens: 100
  };

  try {
    const res = await fetch('/api/settings/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) {
      statusEl.className = 'p-3 rounded-xl text-xs bg-emerald-950/80 text-emerald-300 border border-emerald-700/60';
      statusEl.textContent = '✅ Success: ' + json.data;
      showToast('LLM Connection successful!', 'success');
    } else {
      statusEl.className = 'p-3 rounded-xl text-xs bg-rose-950/80 text-rose-300 border border-rose-700/60';
      statusEl.textContent = '❌ Connection failed: ' + (json.error || 'Unknown error');
      showToast('LLM Connection failed', 'error');
    }
  } catch (err) {
    statusEl.className = 'p-3 rounded-xl text-xs bg-rose-950/80 text-rose-300 border border-rose-700/60';
    statusEl.textContent = '❌ Connection failed: ' + err.message;
    showToast('Connection failed: ' + err.message, 'error');
  }
}

// --- COURSES & TOPICS ---
async function loadCourses() {
  try {
    const res = await fetch('/api/courses');
    const json = await res.json();
    if (json.success && json.data) {
      state.courses = json.data;
      populateCourseDropdowns();
      if (state.courses.length > 0 && !state.selectedCourseIdForDetail) {
        state.selectedCourseIdForDetail = state.currentCourseId || state.courses[0].id;
      }
      renderCoursesHub();
    }
  } catch (err) {
    console.error('Failed to load courses:', err);
  }
}

function populateCourseDropdowns() {
  const gSelect = document.getElementById('globalCourseSelect');
  const nSelect = document.getElementById('noteCourseSelect');
  const dSelect = document.getElementById('docCourseSelect');

  const prevGVal = gSelect.value;

  let gOpts = '<option value="">-- All / General --</option>';
  let nOpts = '<option value="">-- None / General --</option>';
  let dOpts = '';

  state.courses.forEach(c => {
    gOpts += `<option value="${c.id}">${escapeHtml(c.title)}</option>`;
    nOpts += `<option value="${c.id}">${escapeHtml(c.title)}</option>`;
    dOpts += `<option value="${c.id}">${escapeHtml(c.title)}</option>`;
  });

  gSelect.innerHTML = gOpts;
  nSelect.innerHTML = nOpts;
  dSelect.innerHTML = dOpts;

  gSelect.value = state.currentCourseId || prevGVal || '';
}

async function onGlobalCourseChange() {
  const cid = document.getElementById('globalCourseSelect').value;
  state.currentCourseId = cid;
  state.currentTopicId = '';
  updateUrlParams();

  await loadTopicsForCourse(cid);
  await loadChatHistory();
  if (state.currentTab === 'notes') loadNotes();
  if (state.currentTab === 'docs') loadDocs();
}

async function loadTopicsForCourse(courseId) {
  const tSelect = document.getElementById('globalTopicSelect');
  if (!courseId) {
    state.topics = [];
    tSelect.innerHTML = '<option value="">-- All Topics --</option>';
    return;
  }

  try {
    const res = await fetch(`/api/courses/${courseId}/topics`);
    const json = await res.json();
    if (json.success && json.data) {
      state.topics = json.data;
      
      // Group topics by chapter for clean selector navigation
      const chapters = {};
      state.topics.forEach(t => {
        const ch = t.chapter || 'General Modules';
        if (!chapters[ch]) chapters[ch] = [];
        chapters[ch].push(t);
      });

      let opts = '<option value="">-- All Topics --</option>';
      for (const [chapterName, chapterTopics] of Object.entries(chapters)) {
        opts += `<optgroup label="${escapeHtml(chapterName)}">`;
        chapterTopics.forEach(t => {
          opts += `<option value="${t.id}">${escapeHtml(t.title)}</option>`;
        });
        opts += `</optgroup>`;
      }

      tSelect.innerHTML = opts;
      if (state.currentTopicId) {
        tSelect.value = state.currentTopicId;
      }
    }
  } catch (err) {
    console.error('Failed to load topics:', err);
  }
}

async function onGlobalTopicChange() {
  state.currentTopicId = document.getElementById('globalTopicSelect').value;
  updateUrlParams();
  await loadChatHistory();
  if (state.currentTab === 'notes') loadNotes();
}

// --- COURSES HUB RENDER ---
function renderCoursesHub() {
  const listEl = document.getElementById('coursesList');
  if (!listEl) return;

  if (state.courses.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-xs">
        <p>No courses yet.</p>
        <button onclick="openModal('createCourseModal')" class="mt-2 text-emerald-400 hover:underline">Create your first course</button>
      </div>
    `;
    document.getElementById('courseDetailPanel').innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
        <i data-lucide="book-open" class="w-10 h-10 stroke-1"></i>
        <p class="text-sm">Create a course to organize syllabus and topics</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  listEl.innerHTML = state.courses.map(c => {
    const isSelected = c.id === state.selectedCourseIdForDetail;
    return `
      <div onclick="selectCourseDetail('${c.id}')" class="p-3 rounded-xl cursor-pointer border transition-all ${
        isSelected
          ? 'bg-emerald-950/40 border-emerald-500/50 text-slate-100 shadow-md'
          : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800/40'
      }">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-cyan-400 uppercase tracking-wider">${escapeHtml(c.category || 'General')}</span>
          <span class="text-[10px] text-slate-500">${new Date(c.updated_at).toLocaleDateString()}</span>
        </div>
        <h4 class="font-semibold text-xs mt-1.5 text-slate-100">${escapeHtml(c.title)}</h4>
        <p class="text-[11px] text-slate-400 mt-1 line-clamp-2">${escapeHtml(c.description || 'No description provided')}</p>
      </div>
    `;
  }).join('');

  if (state.selectedCourseIdForDetail) {
    loadCourseDetail(state.selectedCourseIdForDetail);
  }

  if (window.lucide) lucide.createIcons();
}

async function selectCourseDetail(courseId) {
  state.selectedCourseIdForDetail = courseId;
  state.currentCourseId = courseId;
  state.currentTopicId = '';
  document.getElementById('globalCourseSelect').value = courseId;
  updateUrlParams();
  await loadTopicsForCourse(courseId);
  renderCoursesHub();
}

let activeTopicSearchFilter = '';

function onTopicSearchInput(val) {
  activeTopicSearchFilter = (val || '').toLowerCase().trim();
  renderGroupedTopics();
}

let currentDetailTopics = [];

function renderGroupedTopics() {
  const container = document.getElementById('groupedTopicsContainer');
  if (!container) return;

  const filtered = activeTopicSearchFilter
    ? currentDetailTopics.filter(t => 
        (t.title && t.title.toLowerCase().includes(activeTopicSearchFilter)) ||
        (t.chapter && t.chapter.toLowerCase().includes(activeTopicSearchFilter)) ||
        (t.summary && t.summary.toLowerCase().includes(activeTopicSearchFilter))
      )
    : currentDetailTopics;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-500 text-xs italic">
        ${currentDetailTopics.length === 0 ? 'No topics added yet. Click "+ Add Topic" to structure your syllabus modules.' : 'No topics matching your filter.'}
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  // Group by chapter
  const chapters = {};
  filtered.forEach(t => {
    const ch = t.chapter || 'General Modules';
    if (!chapters[ch]) chapters[ch] = [];
    chapters[ch].push(t);
  });

  let html = '';
  for (const [chapterName, chapterTopics] of Object.entries(chapters)) {
    const masteredCount = chapterTopics.filter(t => t.mastery_level === 'mastered').length;
    const progressPct = Math.round((masteredCount / chapterTopics.length) * 100);

    html += `
      <div class="border border-slate-800/80 bg-slate-950/40 rounded-xl overflow-hidden mb-3">
        <!-- Chapter Header Accordion -->
        <div class="px-4 py-2.5 bg-slate-900/80 flex items-center justify-between border-b border-slate-800/60">
          <div class="flex items-center space-x-2">
            <i data-lucide="folder" class="w-4 h-4 text-cyan-400"></i>
            <span class="font-semibold text-xs text-slate-200">${escapeHtml(chapterName)}</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400">${chapterTopics.length}</span>
          </div>
          <div class="flex items-center space-x-2 text-[10px] text-slate-400">
            <span>${masteredCount}/${chapterTopics.length} Mastered (${progressPct}%)</span>
          </div>
        </div>

        <!-- Chapter Topics List -->
        <div class="p-2 space-y-1.5">
          ${chapterTopics.map(t => {
            const masteryBadge = {
              to_learn: '<span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">⏳ To Learn</span>',
              in_progress: '<span class="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/40">🚀 In Progress</span>',
              mastered: '<span class="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/40">✅ Mastered</span>',
              review_needed: '<span class="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40">🔁 Review</span>'
            }[t.mastery_level] || '';

            const scoreBadge = (t.quiz_score !== undefined && t.quiz_score !== null)
              ? `<span class="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/50 font-mono">🎯 ${Math.round(t.quiz_score)}% (${t.quizzes_taken || 1}Q)</span>`
              : '';

            return `
              <div onclick="selectAndGoToTopic('${t.course_id}', '${t.id}')" class="p-2.5 bg-slate-900/40 hover:bg-slate-800/80 border border-slate-800/50 hover:border-cyan-500/40 rounded-lg flex items-center justify-between transition cursor-pointer group">
                <div class="space-y-0.5 flex-1 pr-2">
                  <div class="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span class="text-xs font-medium text-slate-200 group-hover:text-cyan-300 transition">${escapeHtml(t.title)}</span>
                    ${masteryBadge}
                    ${scoreBadge}
                  </div>
                  ${t.summary ? `<p class="text-[11px] text-slate-400 line-clamp-1">${escapeHtml(t.summary)}</p>` : ''}
                </div>
                <div class="flex items-center space-x-1.5 shrink-0" onclick="event.stopPropagation()">
                  <button onclick="startInteractiveQuiz('${t.course_id}', '${t.id}')" class="px-2.5 py-1 bg-amber-950/80 hover:bg-amber-900 border border-amber-800/60 text-amber-300 text-[11px] rounded-lg font-medium flex items-center space-x-1 transition shadow-sm" title="Active Recall Quiz on this Topic">
                    <i data-lucide="help-circle" class="w-3 h-3 text-amber-400"></i>
                    <span>Quiz</span>
                  </button>
                  <button onclick="studyTopicWithAI('${t.course_id}', '${t.id}', '${escapeHtml(t.title)}')" class="px-2.5 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-800/60 text-cyan-300 text-[11px] rounded-lg font-medium flex items-center space-x-1 transition shadow-sm" title="Ask AI to introduce this topic">
                    <i data-lucide="sparkles" class="w-3 h-3"></i>
                    <span>Explain</span>
                  </button>
                  <button onclick="editTopicModal('${t.id}')" class="p-1 hover:text-slate-200 text-slate-500 transition" title="Edit topic">
                    <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                  </button>
                  <button onclick="deleteTopic('${t.id}')" class="p-1 hover:text-rose-400 text-slate-500 transition" title="Delete topic">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  if (window.lucide) lucide.createIcons();
}

async function loadCourseDetail(courseId) {
  const panel = document.getElementById('courseDetailPanel');
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return;

  // Load topics for this course
  currentDetailTopics = [];
  try {
    const res = await fetch(`/api/courses/${courseId}/topics`);
    const json = await res.json();
    if (json.success) currentDetailTopics = json.data;
  } catch (err) {}

  panel.innerHTML = `
    <!-- Header -->
    <div class="flex items-start justify-between border-b border-slate-800 pb-4">
      <div>
        <div class="flex items-center space-x-2">
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/60">${escapeHtml(course.category)}</span>
          <h2 class="text-lg font-bold text-slate-100">${escapeHtml(course.title)}</h2>
        </div>
        <p class="text-xs text-slate-400 mt-1">${escapeHtml(course.description || 'No description')}</p>
      </div>
      <div class="flex items-center space-x-2">
        <button onclick="generateCourseStudyGuide('${course.id}')" class="px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-medium flex items-center space-x-1.5 shadow" title="NotebookLM-style Formula Cheat Sheet & Study Guide">
          <i data-lucide="sparkles" class="w-3.5 h-3.5 text-purple-200"></i>
          <span>Study Guide</span>
        </button>
        <button onclick="setGlobalActiveCourse('${course.id}')" class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center space-x-1 shadow">
          <i data-lucide="play-circle" class="w-3.5 h-3.5"></i>
          <span>Study with AI</span>
        </button>
        <button onclick="editCourseModal('${course.id}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="Edit course">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
        <button onclick="deleteCourse('${course.id}')" class="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400" title="Delete course">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    </div>

    <!-- Topics Section with Instant Chapter Grouping & Live Filter -->
    <div class="space-y-3">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
          <i data-lucide="layers" class="w-4 h-4 text-cyan-400"></i>
          <span>Chapters & Modular Topics (${currentDetailTopics.length})</span>
        </h3>
        
        <div class="flex items-center space-x-2">
          <!-- Live Topic Search Bar -->
          <div class="relative">
            <i data-lucide="search" class="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500"></i>
            <input type="text" oninput="onTopicSearchInput(this.value)" placeholder="Filter topics or chapters..." class="bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-44">
          </div>

          <button onclick="openAddTopicModal('${course.id}')" class="text-xs bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1 rounded-lg flex items-center space-x-1 font-medium shadow-sm transition">
            <i data-lucide="plus" class="w-3.5 h-3.5"></i>
            <span>Add Topic</span>
          </button>
        </div>
      </div>

      <!-- Grouped Topics Container -->
      <div id="groupedTopicsContainer" class="space-y-2">
        <!-- Rendered via renderGroupedTopics -->
      </div>
    </div>

    <!-- Syllabus Content Viewer -->
    <div class="space-y-2 border-t border-slate-800 pt-4">
      <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
        <i data-lucide="scroll" class="w-4 h-4 text-emerald-400"></i>
        <span>Syllabus & Curriculum Overview</span>
      </h3>
      <div id="renderedSyllabus" class="p-4 bg-slate-950/80 border border-slate-800/80 rounded-xl text-xs prose prose-invert max-w-none"></div>
    </div>
  `;

  renderGroupedTopics();
  renderMarkdownWithLatex(course.syllabus || '*No syllabus text added for this course yet.*', document.getElementById('renderedSyllabus'));
  if (window.lucide) lucide.createIcons();
}

function setGlobalActiveCourse(courseId) {
  document.getElementById('globalCourseSelect').value = courseId;
  onGlobalCourseChange();
  switchTab('tutor');
}

async function selectAndGoToTopic(courseId, topicId) {
  state.currentCourseId = courseId;
  state.currentTopicId = topicId;
  
  document.getElementById('globalCourseSelect').value = courseId;
  await loadTopicsForCourse(courseId);
  document.getElementById('globalTopicSelect').value = topicId;
  
  updateUrlParams();
  switchTab('tutor');
  await loadChatHistory();
}

async function studyTopicWithAI(courseId, topicId, topicTitle) {
  state.currentCourseId = courseId;
  state.currentTopicId = topicId;
  
  document.getElementById('globalCourseSelect').value = courseId;
  await loadTopicsForCourse(courseId);
  document.getElementById('globalTopicSelect').value = topicId;
  
  updateUrlParams();
  switchTab('tutor');
  await loadChatHistory();
  
  sendQuickPrompt(`I would like to study the topic: "${topicTitle}". Please provide an intuitive introduction with core LaTeX equations, theorems, and practical applications!`);
}

// Course Form Handling
async function submitCourseForm() {
  const id = document.getElementById('editCourseId').value;
  const title = document.getElementById('courseTitleInput').value.trim();
  const category = document.getElementById('courseCategoryInput').value.trim();
  const description = document.getElementById('courseDescInput').value.trim();
  const syllabus = document.getElementById('courseSyllabusInput').value.trim();

  if (!title) {
    showToast('Please enter a course title', 'warning');
    return;
  }

  const payload = { title, category, description, syllabus };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/courses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const json = await res.json();
    if (json.success) {
      closeModal('createCourseModal');
      await loadCourses();
      showToast(id ? 'Course updated successfully!' : 'Course created successfully!', 'success');
      if (json.data && json.data.id) {
        state.selectedCourseIdForDetail = json.data.id;
        state.currentCourseId = json.data.id;
        updateUrlParams();
        renderCoursesHub();
      }
    } else {
      showToast('Error: ' + json.error, 'error');
    }
  } catch (err) {
    showToast('Failed to save course: ' + err.message, 'error');
  }
}

function editCourseModal(courseId) {
  const c = state.courses.find(x => x.id === courseId);
  if (!c) return;

  document.getElementById('editCourseId').value = c.id;
  document.getElementById('courseModalTitle').textContent = 'Edit Course';
  document.getElementById('courseTitleInput').value = c.title;
  document.getElementById('courseCategoryInput').value = c.category;
  document.getElementById('courseDescInput').value = c.description;
  document.getElementById('courseSyllabusInput').value = c.syllabus;

  openModal('createCourseModal');
}

async function deleteCourse(courseId) {
  const confirmed = await showConfirmDialog(
    'Delete Course',
    'Are you sure you want to delete this course and all associated topics, notes, and documents? This cannot be undone.',
    { confirmText: 'Delete Course', isDangerous: true }
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/courses/${courseId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      state.selectedCourseIdForDetail = null;
      if (state.currentCourseId === courseId) {
        state.currentCourseId = '';
        state.currentTopicId = '';
        updateUrlParams();
      }
      showToast('Course deleted successfully', 'info');
      await loadCourses();
    }
  } catch (err) {
    showToast('Failed to delete course: ' + err.message, 'error');
  }
}

// Topic Form Handling
function openAddTopicModal(courseId) {
  document.getElementById('editTopicId').value = '';
  document.getElementById('topicModalTitle').textContent = 'Add Topic to Course';
  document.getElementById('topicChapterInput').value = '';
  document.getElementById('topicTitleInput').value = '';
  document.getElementById('topicMasteryInput').value = 'to_learn';
  document.getElementById('topicSummaryInput').value = '';
  openModal('createTopicModal');
}

function editTopicModal(topicId) {
  const topic = currentDetailTopics.find(t => t.id === topicId);
  if (!topic) return;

  document.getElementById('editTopicId').value = topic.id;
  document.getElementById('topicModalTitle').textContent = 'Edit Topic';
  document.getElementById('topicChapterInput').value = topic.chapter || '';
  document.getElementById('topicTitleInput').value = topic.title || '';
  document.getElementById('topicMasteryInput').value = topic.mastery_level || 'to_learn';
  document.getElementById('topicSummaryInput').value = topic.summary || '';
  openModal('createTopicModal');
}

async function submitTopicForm() {
  const id = document.getElementById('editTopicId').value;
  const courseId = state.selectedCourseIdForDetail;
  const chapter = document.getElementById('topicChapterInput').value.trim() || 'General Modules';
  const title = document.getElementById('topicTitleInput').value.trim();
  const mastery_level = document.getElementById('topicMasteryInput').value;
  const summary = document.getElementById('topicSummaryInput').value.trim();

  if (!title) {
    showToast('Please enter a topic title', 'warning');
    return;
  }

  try {
    let res;
    if (id) {
      const payload = { chapter, title, mastery_level, summary };
      res = await fetch(`/api/topics/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      const payload = {
        course_id: courseId,
        chapter,
        title,
        mastery_level,
        summary,
        order_index: 0
      };
      res = await fetch('/api/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const json = await res.json();
    if (json.success) {
      closeModal('createTopicModal');
      showToast(id ? 'Topic updated!' : 'Topic added to course!', 'success');
      await loadCourseDetail(courseId);
      await loadTopicsForCourse(state.currentCourseId);
    } else {
      showToast('Error: ' + json.error, 'error');
    }
  } catch (err) {
    showToast('Failed to save topic: ' + err.message, 'error');
  }
}

async function deleteTopic(topicId) {
  const confirmed = await showConfirmDialog(
    'Delete Topic',
    'Are you sure you want to remove this topic from the course curriculum?',
    { confirmText: 'Delete Topic', isDangerous: true }
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/topics/${topicId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Topic removed successfully', 'info');
      if (state.currentTopicId === topicId) {
        state.currentTopicId = '';
        updateUrlParams();
      }
      await loadCourseDetail(state.selectedCourseIdForDetail);
      await loadTopicsForCourse(state.currentCourseId);
    }
  } catch (err) {
    showToast('Failed to delete topic: ' + err.message, 'error');
  }
}

// --- NOTES & BOOKMARK VAULT ---
async function loadNotes() {
  const query = document.getElementById('noteSearchInput') ? document.getElementById('noteSearchInput').value : '';
  const params = new URLSearchParams();
  if (state.currentCourseId) params.append('course_id', state.currentCourseId);
  if (state.currentTopicId) params.append('topic_id', state.currentTopicId);
  if (state.onlyBookmarked) params.append('bookmarked', 'true');
  if (query) params.append('q', query);

  try {
    const res = await fetch(`/api/notes?${params.toString()}`);
    const json = await res.json();
    if (json.success && json.data) {
      state.notes = json.data;
      renderNotesList();
      updateBookmarkStats();
    }
  } catch (err) {
    console.error('Failed to load notes:', err);
  }
}

function updateBookmarkStats() {
  const count = state.notes.filter(n => n.is_bookmarked).length;
  const statEl = document.getElementById('statBookmarkCount');
  if (statEl) statEl.textContent = `${count} notes`;
}

function toggleBookmarkFilter() {
  state.onlyBookmarked = !state.onlyBookmarked;
  const btn = document.getElementById('btnFilterBookmarked');
  if (state.onlyBookmarked) {
    btn.className = 'flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400 font-medium transition';
  } else {
    btn.className = 'flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-300 hover:text-amber-400 transition';
  }
  loadNotes();
}

function renderNotesList() {
  const container = document.getElementById('notesListContainer');
  if (!container) return;

  if (state.notes.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-slate-500 text-xs">
        <p>No notes found.</p>
        <button onclick="openCreateNoteModal()" class="mt-2 text-emerald-400 hover:underline">Create a study note</button>
      </div>
    `;
    document.getElementById('noteDetailContainer').innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
        <i data-lucide="file-text" class="w-10 h-10 stroke-1"></i>
        <p class="text-sm">Select a note to view rendered LaTeX equations, or create a new one</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = state.notes.map(n => {
    const isSelected = n.id === state.selectedNoteId;
    const isBookmarked = n.is_bookmarked;
    return `
      <div onclick="selectNoteDetail('${n.id}')" class="p-3 rounded-xl cursor-pointer border transition-all relative ${
        isSelected
          ? 'bg-emerald-950/40 border-emerald-500/50 text-slate-100 shadow-md'
          : 'bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800/40'
      }">
        <div class="flex items-center justify-between">
          <h4 class="font-semibold text-xs text-slate-100 truncate pr-6">${escapeHtml(n.title)}</h4>
          <button onclick="event.stopPropagation(); toggleNoteBookmark('${n.id}')" class="text-slate-500 hover:text-amber-400 p-0.5 transition">
            <i data-lucide="star" class="w-4 h-4 ${isBookmarked ? 'fill-amber-400 text-amber-400' : ''}"></i>
          </button>
        </div>
        <p class="text-[11px] text-slate-400 mt-1 line-clamp-2">${escapeHtml(n.content.replace(/[#$*]/g, ''))}</p>
        <div class="flex items-center justify-between mt-2 text-[10px] text-slate-500">
          <div class="flex flex-wrap gap-1">
            ${n.tags.map(t => `<span class="px-1.5 py-0.2 bg-slate-800 rounded text-slate-400">#${escapeHtml(t)}</span>`).join('')}
          </div>
          <span>${new Date(n.updated_at).toLocaleDateString()}</span>
        </div>
      </div>
    `;
  }).join('');

  if (state.selectedNoteId && state.notes.some(n => n.id === state.selectedNoteId)) {
    displayNoteDetail(state.selectedNoteId);
  } else if (state.notes.length > 0) {
    selectNoteDetail(state.notes[0].id);
  }

  if (window.lucide) lucide.createIcons();
}

function selectNoteDetail(noteId) {
  state.selectedNoteId = noteId;
  updateUrlParams();
  renderNotesList();
  displayNoteDetail(noteId);
}

function displayNoteDetail(noteId) {
  const note = state.notes.find(n => n.id === noteId);
  const container = document.getElementById('noteDetailContainer');
  if (!note || !container) return;

  const course = state.courses.find(c => c.id === note.course_id);

  container.innerHTML = `
    <div class="flex items-start justify-between border-b border-slate-800 pb-4">
      <div>
        <div class="flex items-center space-x-2">
          ${course ? `<span class="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60">${escapeHtml(course.title)}</span>` : ''}
          <h2 class="text-lg font-bold text-slate-100">${escapeHtml(note.title)}</h2>
        </div>
        <div class="flex items-center space-x-3 text-xs text-slate-500 mt-1">
          <span>Updated: ${new Date(note.updated_at).toLocaleString()}</span>
          ${note.tags.length > 0 ? `<span>Tags: ${note.tags.map(t => escapeHtml(t)).join(', ')}</span>` : ''}
        </div>
      </div>

      <div class="flex items-center space-x-2">
        <button onclick="toggleNoteBookmark('${note.id}')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="Bookmark note">
          <i data-lucide="star" class="w-4 h-4 ${note.is_bookmarked ? 'fill-amber-400 text-amber-400' : ''}"></i>
        </button>
        <button onclick="editNoteModal('${note.id}')" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300" title="Edit note">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
        <button onclick="deleteNote('${note.id}')" class="p-2 rounded-lg bg-slate-800 hover:bg-rose-950 text-rose-400" title="Delete note">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    </div>

    <!-- Rendered Markdown + LaTeX Content -->
    <div id="renderedNoteBody" class="mt-4 p-4 bg-slate-950/60 border border-slate-800/60 rounded-xl text-xs prose prose-invert max-w-none flex-1 overflow-y-auto"></div>
  `;

  renderMarkdownWithLatex(note.content, document.getElementById('renderedNoteBody'));
  if (window.lucide) lucide.createIcons();
}

async function toggleNoteBookmark(noteId) {
  try {
    const res = await fetch(`/api/notes/${noteId}/bookmark`, { method: 'POST' });
    const json = await res.json();
    if (json.success) {
      showToast(json.data.is_bookmarked ? 'Note bookmarked ⭐' : 'Bookmark removed', 'info', 2000);
      await loadNotes();
    }
  } catch (err) {
    showToast('Failed to toggle bookmark: ' + err.message, 'error');
  }
}

function openCreateNoteModal(prefillTitle = '', prefillContent = '', prefillTags = []) {
  document.getElementById('editNoteId').value = '';
  document.getElementById('noteModalTitle').textContent = 'Create Study Note';
  document.getElementById('noteTitleInput').value = prefillTitle;
  document.getElementById('noteCourseSelect').value = state.currentCourseId || '';
  document.getElementById('noteTagsInput').value = prefillTags.join(', ');
  document.getElementById('noteContentInput').value = prefillContent;
  document.getElementById('noteBookmarkCheck').checked = false;

  updateNoteModalPreview();
  openModal('createNoteModal');
}

function editNoteModal(noteId) {
  const n = state.notes.find(x => x.id === noteId);
  if (!n) return;

  document.getElementById('editNoteId').value = n.id;
  document.getElementById('noteModalTitle').textContent = 'Edit Study Note';
  document.getElementById('noteTitleInput').value = n.title;
  document.getElementById('noteCourseSelect').value = n.course_id || '';
  document.getElementById('noteTagsInput').value = n.tags.join(', ');
  document.getElementById('noteContentInput').value = n.content;
  document.getElementById('noteBookmarkCheck').checked = n.is_bookmarked;

  updateNoteModalPreview();
  openModal('createNoteModal');
}

function updateNoteModalPreview() {
  const content = document.getElementById('noteContentInput').value;
  const previewEl = document.getElementById('noteContentPreview');
  renderMarkdownWithLatex(content || '*Live preview of your Markdown and LaTeX formulas will appear here...*', previewEl);
}

async function submitNoteForm() {
  const id = document.getElementById('editNoteId').value;
  const title = document.getElementById('noteTitleInput').value.trim();
  const course_id = document.getElementById('noteCourseSelect').value || null;
  const content = document.getElementById('noteContentInput').value.trim();
  const tagsStr = document.getElementById('noteTagsInput').value.trim();
  const is_bookmarked = document.getElementById('noteBookmarkCheck').checked;

  if (!title || !content) {
    showToast('Please enter both a title and content for your note.', 'warning');
    return;
  }

  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];
  const payload = {
    title,
    content,
    course_id,
    topic_id: state.currentTopicId || null,
    tags,
    is_bookmarked
  };

  try {
    let res;
    if (id) {
      res = await fetch(`/api/notes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const json = await res.json();
    if (json.success) {
      closeModal('createNoteModal');
      showToast(id ? 'Note updated successfully!' : 'Note created successfully!', 'success');
      await loadNotes();
      if (json.data && json.data.id) {
        selectNoteDetail(json.data.id);
      }
    } else {
      showToast('Error: ' + json.error, 'error');
    }
  } catch (err) {
    showToast('Failed to save note: ' + err.message, 'error');
  }
}

async function deleteNote(noteId) {
  const confirmed = await showConfirmDialog(
    'Delete Study Note',
    'Are you sure you want to permanently delete this note?',
    { confirmText: 'Delete Note', isDangerous: true }
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/notes/${noteId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      state.selectedNoteId = null;
      showToast('Note deleted', 'info');
      await loadNotes();
    }
  } catch (err) {
    showToast('Failed to delete note: ' + err.message, 'error');
  }
}

async function generateNoteWithAI() {
  const title = document.getElementById('noteTitleInput').value.trim();
  const promptText = title || prompt('What concept or formula would you like the AI to synthesize into a structured study note?');
  if (!promptText) return;

  const contentArea = document.getElementById('noteContentInput');
  const prevVal = contentArea.value;
  contentArea.value = '⚡ AI is synthesizing LaTeX note formulas and explanations...';
  showToast('Synthesizing structured LaTeX note...', 'info', 2500);

  try {
    const res = await fetch('/api/generate-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: promptText,
        course_id: state.currentCourseId || null,
        topic_id: state.currentTopicId || null
      })
    });
    const json = await res.json();
    if (json.success && json.data) {
      contentArea.value = json.data;
      if (!title) document.getElementById('noteTitleInput').value = promptText;
      updateNoteModalPreview();
      showToast('AI note synthesized successfully!', 'success');
    } else {
      showToast('Failed: ' + json.error, 'error');
      contentArea.value = prevVal;
    }
  } catch (err) {
    showToast('AI note generation error: ' + err.message, 'error');
    contentArea.value = prevVal;
  }
}

// --- KNOWLEDGE VAULT (DOCS) ---
async function loadDocs() {
  const container = document.getElementById('docsGridContainer');
  if (!container) return;

  if (!state.currentCourseId && state.courses.length > 0) {
    state.currentCourseId = state.courses[0].id;
  }

  if (!state.currentCourseId) {
    container.innerHTML = '<p class="text-xs text-slate-500 col-span-full py-8 text-center">Please create or select a course first.</p>';
    return;
  }

  try {
    const res = await fetch(`/api/courses/${state.currentCourseId}/docs`);
    const json = await res.json();
    if (json.success && json.data) {
      state.docs = json.data;
      if (state.docs.length === 0) {
        container.innerHTML = `
          <div class="col-span-full text-center py-12 text-slate-500 text-xs">
            <p>No documents uploaded in this course vault.</p>
            <button onclick="openModal('addDocModal')" class="mt-2 text-cyan-400 hover:underline">Add textbook chapter or paper</button>
          </div>
        `;
      } else {
        container.innerHTML = state.docs.map(d => `
          <div class="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between space-y-3">
            <div>
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 uppercase">${escapeHtml(d.doc_type)}</span>
                <button onclick="deleteDoc('${d.id}')" class="text-slate-500 hover:text-rose-400">
                  <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
              </div>
              <h4 class="font-bold text-xs text-slate-100 mt-2">${escapeHtml(d.title)}</h4>
              <p class="text-[11px] text-slate-400 mt-1 line-clamp-4 font-mono">${escapeHtml(d.content)}</p>
            </div>
            <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px] text-slate-500">
              <span>${new Date(d.created_at).toLocaleDateString()}</span>
              <span class="text-emerald-400 font-medium">Grounding Active</span>
            </div>
          </div>
        `).join('');
      }
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    console.error('Failed to load docs:', err);
  }
}

async function submitDocForm() {
  const course_id = document.getElementById('docCourseSelect').value;
  const title = document.getElementById('docTitleInput').value.trim();
  const doc_type = document.getElementById('docTypeInput').value;
  const content = document.getElementById('docContentInput').value.trim();

  if (!title || !content || !course_id) {
    showToast('Please fill out all required fields.', 'warning');
    return;
  }

  const payload = { course_id, title, doc_type, content, topic_id: null };

  try {
    const res = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json.success) {
      closeModal('addDocModal');
      showToast('Document added to vault!', 'success');
      await loadDocs();
    } else {
      showToast('Error: ' + json.error, 'error');
    }
  } catch (err) {
    showToast('Failed to add document: ' + err.message, 'error');
  }
}

async function deleteDoc(docId) {
  const confirmed = await showConfirmDialog(
    'Delete Reference Document',
    'Are you sure you want to remove this document from the AI Knowledge Vault?',
    { confirmText: 'Delete Document', isDangerous: true }
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`/api/docs/${docId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Document deleted from vault', 'info');
      await loadDocs();
    }
  } catch (err) {
    showToast('Failed to delete doc: ' + err.message, 'error');
  }
}

// --- AI TUTOR & CHAT LOGIC ---
async function loadChatHistory() {
  const params = new URLSearchParams();
  if (state.currentCourseId) params.append('course_id', state.currentCourseId);
  if (state.currentTopicId) params.append('topic_id', state.currentTopicId);

  try {
    const res = await fetch(`/api/chat/history?${params.toString()}`);
    const json = await res.json();
    if (json.success && json.data) {
      renderChatMessages(json.data);
    }
  } catch (err) {
    console.error('Failed to load chat history:', err);
  }
}

function renderChatMessages(messages) {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div class="max-w-3xl mx-auto bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
        <div class="flex items-start space-x-4">
          <div class="w-12 h-12 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
            <i data-lucide="sparkles" class="w-6 h-6 text-white"></i>
          </div>
          <div class="space-y-2">
            <h3 class="text-base font-semibold text-slate-100">Welcome to Scholarr! Your Adaptive AI Research Mentor</h3>
            <p class="text-sm text-slate-300 leading-relaxed">
              I will teach and guide you with customized explanations tailored to your knowledge level, using rigorous LaTeX formulas and intuitive breakdowns.
            </p>
            <div class="pt-2 flex flex-wrap gap-2 text-xs">
              <button onclick="sendQuickPrompt('Explain Convolution in LTI Systems using step-by-step integrals and provide a Python code block with Matplotlib to simulate and plot the signals and their resulting convolution output.')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition flex items-center space-x-1.5">
                <span>🐍</span>
                <span>Simulate Convolution with Python</span>
              </button>
              <button onclick="sendQuickPrompt('Create a 3Blue1Brown style Manim animation scene in Python visualizing how a continuous-time signal is decomposed into shifted impulse delta functions.')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition flex items-center space-x-1.5">
                <span>🎬</span>
                <span>3Blue1Brown Manim Animation</span>
              </button>
              <button onclick="sendQuickPrompt('Derive the Continuous-Time Fourier Transform from first principles with LaTeX and intuitive geometric meaning.')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition flex items-center space-x-1.5">
                <span>📐</span>
                <span>Derive Fourier Transform</span>
              </button>
              <button onclick="sendQuickPrompt('Give me a 3-question conceptual quiz on our current topic to test my mastery.')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition flex items-center space-x-1.5">
                <span>🎯</span>
                <span>Quiz Me on Topic</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  container.innerHTML = messages.map(m => {
    const isUser = m.role === 'user';
    const roleIcon = isUser ? '👤' : (state.profile ? (state.profile.tone === 'socratic' ? '🦉' : '🎓') : '🎓');

    return `
      <div class="flex items-start space-x-3 max-w-4xl mx-auto ${isUser ? 'justify-end' : 'justify-start'}">
        ${!isUser ? `<div class="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-sm shadow-md">${roleIcon}</div>` : ''}
        
        <div class="max-w-2xl rounded-2xl p-4 text-xs shadow-lg ${isUser ? 'chat-bubble-user text-slate-100 rounded-tr-none' : 'chat-bubble-assistant text-slate-200 rounded-tl-none'} space-y-2">
          <div class="prose prose-invert max-w-none message-body"></div>
          
          ${!isUser ? `
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span class="text-slate-500">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <button onclick="saveMessageAsNote(this)" data-content="${encodeURIComponent(m.content)}" class="text-emerald-400 hover:text-emerald-300 font-medium flex items-center space-x-1">
                <i data-lucide="bookmark-plus" class="w-3.5 h-3.5"></i>
                <span>Save as Note</span>
              </button>
            </div>
          ` : ''}
        </div>

        ${isUser ? `<div class="w-8 h-8 rounded-xl bg-emerald-600/80 flex items-center justify-center shrink-0 text-xs text-white shadow-md">You</div>` : ''}
      </div>
    `;
  }).join('');

  // Render markdown + LaTeX for all message bodies
  container.querySelectorAll('.message-body').forEach((el, idx) => {
    renderMarkdownWithLatex(messages[idx].content, el);
  });

  if (window.lucide) lucide.createIcons();
  scrollChatToBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  if (container) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  }
}

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

function sendQuickPrompt(promptText) {
  const input = document.getElementById('chatInput');
  input.value = promptText;
  sendChatMessage();
}

window.sendChatMessage = async function() {
  if (state.isSendingChat) return;

  const input = document.getElementById('chatInput');
  if (!input) return;
  const message = input.value.trim();
  if (!message) return;

  state.isSendingChat = true;
  input.value = '';

  let loadingId = 'loading-' + Date.now();

  try {
    const container = document.getElementById('chatMessages');

    // Append user message UI immediately
    if (container) {
      const userHtml = `
        <div class="flex items-start space-x-3 max-w-4xl mx-auto justify-end">
          <div class="max-w-2xl rounded-2xl p-4 text-xs shadow-lg chat-bubble-user text-slate-100 rounded-tr-none space-y-2">
            <div class="prose prose-invert max-w-none user-body"></div>
          </div>
          <div class="w-8 h-8 rounded-xl bg-emerald-600/80 flex items-center justify-center shrink-0 text-xs text-white shadow-md">You</div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', userHtml);
      const userNodes = container.querySelectorAll('.user-body');
      if (userNodes.length > 0) {
        try {
          renderMarkdownWithLatex(message, userNodes[userNodes.length - 1]);
        } catch (e) {
          userNodes[userNodes.length - 1].textContent = message;
        }
      }

      // Append Loading placeholder for assistant
      const loadingHtml = `
        <div id="${loadingId}" class="flex items-start space-x-3 max-w-4xl mx-auto justify-start">
          <div class="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-sm shadow-md">🦉</div>
          <div class="max-w-2xl rounded-2xl p-4 text-xs shadow-lg chat-bubble-assistant text-slate-300 rounded-tl-none space-y-2 animate-pulse-subtle">
            <div class="flex items-center space-x-2 text-emerald-400">
              <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
              <span>Synthesizing response with personalized LaTeX math & context...</span>
            </div>
          </div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', loadingHtml);
      if (window.lucide) lucide.createIcons();
      scrollChatToBottom();
    }

    // Sanitize IDs: strip any accidental 'course:' or 'topic:' prefixes
    const cleanCourseId = state.currentCourseId ? state.currentCourseId.replace(/^course:/, '') : null;
    const cleanTopicId = state.currentTopicId ? state.currentTopicId.replace(/^topic:/, '') : null;

    const payload = {
      message,
      course_id: cleanCourseId || null,
      topic_id: cleanTopicId || null,
      include_syllabus: document.getElementById('chkIncludeSyllabus')?.checked ?? true,
      include_notes: document.getElementById('chkIncludeNotes')?.checked ?? true,
      include_docs: document.getElementById('chkIncludeDocs')?.checked ?? true
    };

    console.log('[Scholarr Chat] Sending payload to /api/chat:', payload);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log('[Scholarr Chat] Received response:', json);

    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    if (json.success && json.data) {
      const reply = json.data.reply;
      const sources = json.data.sources_used || [];
      const sourceItems = json.data.source_items || [];
      const msgId = 'msg-' + Date.now();

      let sourcesHtml = '';
      if (sourceItems.length > 0 || sources.length > 0) {
        sourcesHtml = `
          <div class="pt-2 border-t border-slate-800/80 space-y-1.5">
            <div class="flex items-center justify-between text-[11px]">
              <button onclick="toggleGroundingSources('${msgId}')" class="text-cyan-400 hover:text-cyan-300 font-semibold flex items-center space-x-1 transition group">
                <i data-lucide="book-marked" class="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform"></i>
                <span>Grounded In (${sourceItems.length || sources.length} Sources)</span>
                <i id="icon-${msgId}" data-lucide="chevron-down" class="w-3 h-3 text-cyan-400 transition-transform"></i>
              </button>
              <span class="text-[10px] text-slate-500">Click to view/hide excerpts</span>
            </div>

            <!-- Collapsible Source Drawer (Compact max-height, doesn't take whole page) -->
            <div id="sources-${msgId}" class="hidden space-y-2 pt-1 max-h-48 overflow-y-auto pr-1">
              ${sourceItems.map((s, sIdx) => {
                const simBadge = s.similarity ? `<span class="px-1 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono text-[9px] border border-emerald-800/60">${Math.round(s.similarity * 100)}% match</span>` : '';
                const typeIcon = s.source_type === 'doc' ? '📄' : s.source_type === 'note' ? '📝' : '📜';
                return `
                  <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/90 text-xs space-y-1 shadow-sm">
                    <div class="flex items-center justify-between">
                      <span class="font-bold text-[11px] text-slate-200 flex items-center space-x-1">
                        <span>${typeIcon}</span>
                        <span>${escapeHtml(s.title)}</span>
                      </span>
                      ${simBadge}
                    </div>
                    <p class="text-[10px] text-slate-400 font-mono leading-relaxed line-clamp-3 bg-slate-900/60 p-1.5 rounded-lg border border-slate-800/50">
                      ${escapeHtml(s.excerpt)}...
                    </p>
                  </div>
                `;
              }).join('')}
              ${sourceItems.length === 0 ? sources.map(s => `
                <div class="px-2 py-1 rounded-lg bg-slate-950/60 border border-slate-800 text-[10px] text-cyan-300 font-mono">
                  ${escapeHtml(s)}
                </div>
              `).join('') : ''}
            </div>
          </div>
        `;
      }

      const assistantHtml = `
        <div class="flex items-start space-x-3 max-w-4xl mx-auto justify-start">
          <div class="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-sm shadow-md">🦉</div>
          <div class="max-w-2xl rounded-2xl p-4 text-xs shadow-lg chat-bubble-assistant text-slate-200 rounded-tl-none space-y-2">
            <div id="body-${msgId}" class="prose prose-invert max-w-none asst-body"></div>
            ${sourcesHtml}
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span class="text-slate-500">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <button onclick="saveMessageAsNote(this)" data-content="${encodeURIComponent(reply)}" class="text-emerald-400 hover:text-emerald-300 font-medium flex items-center space-x-1">
                <i data-lucide="bookmark-plus" class="w-3.5 h-3.5"></i>
                <span>Save as Note</span>
              </button>
            </div>
          </div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', assistantHtml);
      const asstBodyEl = document.getElementById(`body-${msgId}`);
      if (asstBodyEl) {
        renderMarkdownWithLatex(reply, asstBodyEl);
      }
      if (window.lucide) lucide.createIcons();
      scrollChatToBottom();
    } else {
      const errHtml = `
        <div class="flex items-start space-x-3 max-w-4xl mx-auto justify-start">
          <div class="w-8 h-8 rounded-xl bg-rose-950/80 border border-rose-800 flex items-center justify-center shrink-0 text-sm">⚠️</div>
          <div class="max-w-2xl rounded-2xl p-4 text-xs shadow-lg bg-rose-950/40 border border-rose-800/50 text-rose-200 rounded-tl-none space-y-2">
            <p class="font-semibold">Chat Request Error:</p>
            <p>${escapeHtml(json.error || 'Check your API key in LLM Config settings or in the .env file.')}</p>
          </div>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', errHtml);
      scrollChatToBottom();
    }
  } catch (err) {
    console.error('[Scholarr Chat] Fetch error:', err);
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();
    showToast('Failed to connect to AI Tutor API: ' + err.message, 'error');
  } finally {
    state.isSendingChat = false;
  }
}

function toggleGroundingSources(msgId) {
  const drawer = document.getElementById(`sources-${msgId}`);
  const icon = document.getElementById(`icon-${msgId}`);
  if (drawer) {
    const isHidden = drawer.classList.contains('hidden');
    if (isHidden) {
      drawer.classList.remove('hidden');
      if (icon) icon.style.transform = 'rotate(180deg)';
    } else {
      drawer.classList.add('hidden');
      if (icon) icon.style.transform = 'rotate(0deg)';
    }
  }
}

function saveMessageAsNote(btn) {
  const content = decodeURIComponent(btn.getAttribute('data-content') || '');
  const title = prompt('Enter a title for this study note:', 'Key Insights & Equations');
  if (!title) return;

  openCreateNoteModal(title, content, ['ai-tutor', 'formula']);
}

async function clearChatHistory() {
  const confirmed = await showConfirmDialog(
    'Clear Chat History',
    'Are you sure you want to clear the conversation messages for this course/topic context?',
    { confirmText: 'Clear Messages', isDangerous: true }
  );
  if (!confirmed) return;

  const params = new URLSearchParams();
  if (state.currentCourseId) params.append('course_id', state.currentCourseId);
  if (state.currentTopicId) params.append('topic_id', state.currentTopicId);

  try {
    const res = await fetch(`/api/chat/history?${params.toString()}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      showToast('Chat history cleared', 'info');
      document.getElementById('chatMessages').innerHTML = `
        <div class="max-w-3xl mx-auto bg-slate-900/60 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <p class="text-xs text-slate-400">Chat history cleared. Start asking questions!</p>
        </div>
      `;
    }
  } catch (err) {
    showToast('Failed to clear history: ' + err.message, 'error');
  }
}

async function triggerPdfIngestion() {
  const path = document.getElementById('ingestPdfPath').value.trim();
  const course = document.getElementById('ingestPdfCourse').value.trim();
  const maxChunks = parseInt(document.getElementById('ingestPdfMaxChunks').value) || null;
  const statusBox = document.getElementById('ingestStatusBox');
  const btn = document.getElementById('btnStartIngest');

  if (!path) {
    showToast('Please specify the absolute path to the PDF file.', 'warning');
    return;
  }

  statusBox.classList.remove('hidden');
  statusBox.className = 'p-3 rounded-xl text-xs bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 animate-pulse-subtle flex items-center space-x-2';
  statusBox.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Extracting text, chunking, and computing vector embeddings via OpenRouter...</span>';
  if (window.lucide) lucide.createIcons();
  btn.disabled = true;

  try {
    const res = await fetch('/api/ingest/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pdf_path: path,
        course_title: course || null,
        max_chunks: maxChunks
      })
    });
    const json = await res.json();
    if (json.success) {
      statusBox.className = 'p-3 rounded-xl text-xs bg-emerald-950 text-emerald-300 border border-emerald-600';
      statusBox.innerHTML = `✅ ${escapeHtml(json.data)}`;
      showToast('PDF textbook ingested and embedded successfully!', 'success');
      await loadCourses();
      await loadDocs();
    } else {
      statusBox.className = 'p-3 rounded-xl text-xs bg-rose-950 text-rose-300 border border-rose-600';
      statusBox.innerHTML = `❌ Ingestion Error: ${escapeHtml(json.error)}`;
      showToast('Ingestion Error: ' + json.error, 'error');
    }
  } catch (err) {
    statusBox.className = 'p-3 rounded-xl text-xs bg-rose-950 text-rose-300 border border-rose-600';
    statusBox.innerHTML = `❌ Request Error: ${escapeHtml(err.message)}`;
    showToast('Request Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// --- GLOBAL KEYBOARD SHORTCUTS & COMMAND PALETTE ---
let cmdPaletteSelectedIndex = 0;
let cmdPaletteFilteredItems = [];

document.addEventListener('keydown', (e) => {
  // Command/Ctrl + K: Open Command Palette
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    openCommandPalette();
  }
  // Escape: Close Command Palette
  if (e.key === 'Escape') {
    closeCommandPalette();
  }
  // Command/Ctrl + Shift + N: Quick New Note
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    openCreateNoteModal();
  }
});

async function openCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  const input = document.getElementById('cmdPaletteInput');
  if (!modal || !input) return;

  modal.classList.remove('hidden');
  input.value = '';
  input.focus();
  cmdPaletteSelectedIndex = 0;
  
  // Ensure notes and course topics are loaded for comprehensive search
  if (state.notes.length === 0) {
    try {
      const res = await fetch('/api/notes');
      const json = await res.json();
      if (json.success && json.data) state.notes = json.data;
    } catch (e) {}
  }

  // If no topics loaded in state, load topics for current course or all courses
  if (state.topics.length === 0 && state.courses.length > 0) {
    for (const c of state.courses) {
      try {
        const res = await fetch(`/api/courses/${c.id}/topics`);
        const json = await res.json();
        if (json.success && json.data) {
          json.data.forEach(t => {
            if (!state.topics.some(existing => existing.id === t.id)) {
              state.topics.push(t);
            }
          });
        }
      } catch (e) {}
    }
  }

  renderCommandPaletteItems('');
}

function closeCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (modal) modal.classList.add('hidden');
}

function onCommandPaletteSearch(query) {
  cmdPaletteSelectedIndex = 0;
  renderCommandPaletteItems(query.trim().toLowerCase());
}

function renderCommandPaletteItems(q) {
  const container = document.getElementById('cmdPaletteResults');
  if (!container) return;

  // Build searchable items from courses, topics, notes, and navigation actions
  const items = [
    { type: 'action', title: 'Start Interactive Quiz', subtitle: 'Active recall AI quiz on current topic', icon: 'help-circle', action: () => { closeCommandPalette(); startInteractiveQuiz(); } },
    { type: 'action', title: 'Open Flashcards & Spaced Repetition', subtitle: 'Active recall flashcards & formulas', icon: 'layers', action: () => { closeCommandPalette(); switchTab('flashcards'); } },
    { type: 'action', title: 'Open Interactive Knowledge Graph', subtitle: 'Obsidian-style 2D concept topology', icon: 'share-2', action: () => { closeCommandPalette(); switchTab('graph'); } },
    { type: 'action', title: 'Create New Study Note', subtitle: 'Markdown + LaTeX note editor', icon: 'file-plus', action: () => { closeCommandPalette(); openCreateNoteModal(); } },
    { type: 'action', title: 'Ingest PDF Textbook / Research Paper', subtitle: 'Extract, chunk & embed into RocksDB', icon: 'upload', action: () => { closeCommandPalette(); openModal('ingestPdfModal'); } },
    { type: 'action', title: 'Switch to AI Tutor Tab', subtitle: 'Chat with AI Mentor with LaTeX support', icon: 'message-square', action: () => { closeCommandPalette(); switchTab('tutor'); } },
    { type: 'action', title: 'Switch to Courses & Syllabus', subtitle: 'View courses, chapters & learning path', icon: 'layers', action: () => { closeCommandPalette(); switchTab('courses'); } },
    { type: 'action', title: 'Switch to Notes & Bookmarks', subtitle: 'Browse all study notes & equations', icon: 'file-text', action: () => { closeCommandPalette(); switchTab('notes'); } },
    { type: 'action', title: 'Switch to Knowledge Vault (Docs)', subtitle: 'Textbook chapters & knowledge base', icon: 'folder-git-2', action: () => { closeCommandPalette(); switchTab('docs'); } },
    { type: 'action', title: 'Configure LLM Provider & Keys', subtitle: 'OpenAI, Gemini, OpenRouter, Groq, Ollama', icon: 'cpu', action: () => { closeCommandPalette(); openModal('llmModal'); } },
    { type: 'action', title: 'Customize Learning Persona', subtitle: 'Socratic, ELI5, Rigorous math tone', icon: 'smile', action: () => { closeCommandPalette(); openModal('personaModal'); } },
  ];

  state.courses.forEach(c => {
    items.push({
      type: 'course',
      title: `Course: ${c.title}`,
      subtitle: `${c.category || 'General'} • ${c.description || 'View syllabus & roadmap'}`,
      icon: 'book-open',
      action: () => {
        closeCommandPalette();
        setGlobalActiveCourse(c.id);
      }
    });
  });

  state.topics.forEach(t => {
    const parentCourse = state.courses.find(c => c.id === t.course_id);
    const courseName = parentCourse ? parentCourse.title : '';
    items.push({
      type: 'topic',
      title: `Topic: ${t.title}`,
      subtitle: `${t.chapter ? t.chapter + ' • ' : ''}${courseName ? courseName + ' • ' : ''}${t.summary || 'Study with AI Tutor'}`,
      icon: 'bookmark',
      action: () => {
        closeCommandPalette();
        studyTopicWithAI(t.course_id || state.currentCourseId, t.id, t.title);
      }
    });
  });

  state.notes.forEach(n => {
    items.push({
      type: 'note',
      title: `Note: ${n.title}`,
      subtitle: n.tags && n.tags.length ? `Tags: ${n.tags.join(', ')}` : 'Study Note',
      icon: 'file-text',
      action: () => {
        closeCommandPalette();
        switchTab('notes');
        selectNoteDetail(n.id);
      }
    });
  });

  cmdPaletteFilteredItems = items.filter(item => {
    if (!q) return true;
    return item.title.toLowerCase().includes(q) || (item.subtitle && item.subtitle.toLowerCase().includes(q));
  });

  if (cmdPaletteFilteredItems.length === 0) {
    container.innerHTML = '<div class="py-6 text-center text-slate-500">No matching commands, courses, topics, or notes found</div>';
    return;
  }

  container.innerHTML = cmdPaletteFilteredItems.map((item, idx) => `
    <div onclick="executeCommandPaletteItem(${idx})" class="p-2.5 rounded-xl cursor-pointer flex items-center justify-between transition border ${
      idx === cmdPaletteSelectedIndex ? 'bg-emerald-950/60 border-emerald-500/50 text-slate-100' : 'border-transparent text-slate-300 hover:bg-slate-800/50'
    }">
      <div class="flex items-center space-x-2.5 truncate flex-1 pr-2">
        <i data-lucide="${item.icon}" class="w-4 h-4 text-emerald-400 shrink-0"></i>
        <div class="truncate">
          <div class="font-medium text-xs text-slate-100">${escapeHtml(item.title)}</div>
          ${item.subtitle ? `<div class="text-[10px] text-slate-400 truncate">${escapeHtml(item.subtitle)}</div>` : ''}
        </div>
      </div>
      <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-mono shrink-0">${item.type}</span>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function handleCommandPaletteKey(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cmdPaletteFilteredItems.length > 0) {
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex + 1) % cmdPaletteFilteredItems.length;
      renderCommandPaletteItems(document.getElementById('cmdPaletteInput').value.trim().toLowerCase());
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cmdPaletteFilteredItems.length > 0) {
      cmdPaletteSelectedIndex = (cmdPaletteSelectedIndex - 1 + cmdPaletteFilteredItems.length) % cmdPaletteFilteredItems.length;
      renderCommandPaletteItems(document.getElementById('cmdPaletteInput').value.trim().toLowerCase());
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (cmdPaletteFilteredItems[cmdPaletteSelectedIndex]) {
      executeCommandPaletteItem(cmdPaletteSelectedIndex);
    }
  }
}

function executeCommandPaletteItem(index) {
  const item = cmdPaletteFilteredItems[index];
  if (item && item.action) {
    item.action();
  }
}

// --- NOTEBOOKLM: 1-CLICK STUDY GUIDE & FORMULA CHEAT-SHEET GENERATION ---
async function generateCourseStudyGuide(courseId) {
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return;

  showToast(`Synthesizing Comprehensive Study Guide for ${course.title}...`, 'info', 4000);
  switchTab('notes');

  const prompt = `Please generate a comprehensive, high-yield Formula Cheat-Sheet and Study Guide for the course "${course.title}".
Format with Obsidian-style callouts:
- > [!DEFINITION] for Core Building Blocks
- > [!THEOREM] for Key Theorems and Mathematical Equations in LaTeX
- > [!PROOF] with step-by-step derivations
- <toggle title="Key Formulas Summary"> ... </toggle> for quick lookup tables.`;

  try {
    const res = await fetch('/api/generate-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        course_id: course.id,
        topic_id: null
      })
    });
    const json = await res.json();
    if (json.success && json.data) {
      // Auto-create study guide note
      const saveRes = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `📖 Study Guide & Cheat Sheet: ${course.title}`,
          content: json.data,
          course_id: course.id,
          topic_id: null,
          tags: ['study-guide', 'formula-sheet', 'cheatsheet'],
          is_bookmarked: true
        })
      });
      const saveJson = await saveRes.json();
      if (saveJson.success) {
        showToast('Study Guide created in Notes!', 'success');
        await loadNotes();
        if (saveJson.data && saveJson.data.id) {
          selectNoteDetail(saveJson.data.id);
        }
      }
    }
  } catch (err) {
    showToast('Failed to generate study guide: ' + err.message, 'error');
  }
}

// --- OBSIDIAN: INTERACTIVE CONCEPT KNOWLEDGE GRAPH (Embedded SQLite Graph DB) ---
let graphNodes = [];
let graphEdges = [];
let graphAnimationId = null;

async function renderKnowledgeGraph() {
  const canvas = document.getElementById('knowledgeGraphCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;

  // Fetch true graph topology from SQLite Embedded Graph DB
  graphNodes = [];
  graphEdges = [];

  try {
    const res = await fetch('/api/graph/data');
    const json = await res.json();
    if (json.success && json.data && json.data.nodes && json.data.nodes.length > 0) {
      const serverNodes = json.data.nodes;
      const serverEdges = json.data.edges;

      const nodeMap = new Map();
      serverNodes.forEach((sn, idx) => {
        const angle = (idx / serverNodes.length) * Math.PI * 2;
        const radiusDist = sn.node_type === 'course' ? 50 : sn.node_type === 'topic' ? 120 : sn.node_type === 'concept' ? 170 : 140;
        const color = sn.node_type === 'course' ? '#06b6d4' : sn.node_type === 'topic' ? '#10b981' : sn.node_type === 'concept' ? '#f59e0b' : '#a855f7';
        const size = sn.node_type === 'course' ? 14 : sn.node_type === 'topic' ? 9 : sn.node_type === 'concept' ? 7 : 6;

        const nodeObj = {
          id: sn.id,
          name: sn.label,
          type: sn.node_type,
          color,
          radius: size,
          x: width / 2 + Math.cos(angle) * radiusDist + (Math.random() - 0.5) * 40,
          y: height / 2 + Math.sin(angle) * radiusDist + (Math.random() - 0.5) * 40,
          vx: 0,
          vy: 0,
          data: sn
        };
        graphNodes.push(nodeObj);
        nodeMap.set(sn.id, nodeObj);
      });

      serverEdges.forEach(se => {
        const src = nodeMap.get(se.source_id);
        const tgt = nodeMap.get(se.target_id);
        if (src && tgt) {
          const edgeColor = se.relation === 'wikilink' ? 'rgba(245, 158, 11, 0.4)' : 'rgba(100, 116, 139, 0.3)';
          graphEdges.push({ source: src, target: tgt, color: edgeColor });
        }
      });
    }
  } catch (err) {
    console.warn('Fallback to local graph assembly:', err);
  }

  // Fallback if empty
  if (graphNodes.length === 0) {
    // 1. Courses (Cyan Central Hubs)
    state.courses.forEach((c, idx) => {
      graphNodes.push({
        id: `course_${c.id}`,
        name: c.title,
        type: 'course',
        color: '#06b6d4',
        radius: 14,
        x: width / 2 + Math.cos((idx / (state.courses.length || 1)) * Math.PI * 2) * 140,
        y: height / 2 + Math.sin((idx / (state.courses.length || 1)) * Math.PI * 2) * 100,
        vx: 0,
        vy: 0,
        data: c
      });
    });

  // 2. Topics (Emerald Satellites)
  state.topics.forEach((t, idx) => {
    const parent = graphNodes.find(n => n.id === `course_${t.course_id}`);
    const px = parent ? parent.x : width / 2;
    const py = parent ? parent.y : height / 2;

    const angle = (idx / (state.topics.length || 1)) * Math.PI * 2;
    const dist = 70 + (idx % 3) * 25;

    const node = {
      id: `topic_${t.id}`,
      name: t.title,
      type: 'topic',
      color: '#10b981',
      radius: 8,
      x: px + Math.cos(angle) * dist,
      y: py + Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
      data: t
    };
    graphNodes.push(node);

    if (parent) {
      graphEdges.push({ source: parent, target: node, color: 'rgba(6, 182, 212, 0.3)' });
    }
  });

  // 3. Notes (Purple Nodes)
  state.notes.forEach((n, idx) => {
    const parentCourse = graphNodes.find(node => node.id === `course_${n.course_id}`);
    const parentTopic = graphNodes.find(node => node.id === `topic_${n.topic_id}`);
    const parent = parentTopic || parentCourse || graphNodes[0];

    const px = parent ? parent.x : width / 2;
    const py = parent ? parent.y : height / 2;
    const angle = (idx / (state.notes.length || 1)) * Math.PI * 2 + 0.5;

    const node = {
      id: `note_${n.id}`,
      name: n.title,
      type: 'note',
      color: '#a855f7',
      radius: 6,
      x: px + Math.cos(angle) * 50,
      y: py + Math.sin(angle) * 50,
      vx: 0,
      vy: 0,
      data: n
    };
    graphNodes.push(node);

    });
  }

  if (graphNodes.length === 0) {
    ctx.fillStyle = '#64748b';
    ctx.font = '13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Create courses, topics, or notes to visualize your knowledge graph', width / 2, height / 2);
    return;
  }

  // Physics animation loop
  let iterations = 0;
  function step() {
    ctx.clearRect(0, 0, width, height);

    // Repulsion between nodes
    for (let i = 0; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        const a = graphNodes[i];
        const b = graphNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 180) {
          const force = (180 - dist) / 180 * 0.4;
          a.x -= (dx / dist) * force;
          a.y -= (dy / dist) * force;
          b.x += (dx / dist) * force;
          b.y += (dy / dist) * force;
        }
      }
    }

    // Spring attraction along edges
    graphEdges.forEach(e => {
      const dx = e.target.x - e.source.x;
      const dy = e.target.y - e.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const targetDist = 70;
      const force = (dist - targetDist) * 0.02;
      e.source.x += (dx / dist) * force;
      e.source.y += (dy / dist) * force;
      e.target.x -= (dx / dist) * force;
      e.target.y -= (dy / dist) * force;
    });

    // Center gravity
    graphNodes.forEach(n => {
      n.x += (width / 2 - n.x) * 0.01;
      n.y += (height / 2 - n.y) * 0.01;
    });

    // Draw Edges
    graphEdges.forEach(e => {
      ctx.beginPath();
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1.2;
      ctx.moveTo(e.source.x, e.source.y);
      ctx.lineTo(e.target.x, e.target.y);
      ctx.stroke();
    });

    // Draw Nodes
    graphNodes.forEach(n => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.shadowColor = n.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Label
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      const truncated = n.name.length > 20 ? n.name.slice(0, 18) + '...' : n.name;
      ctx.fillText(truncated, n.x, n.y + n.radius + 12);
    });

    iterations++;
    if (iterations < 120) {
      graphAnimationId = requestAnimationFrame(step);
    }
  }

  if (graphAnimationId) cancelAnimationFrame(graphAnimationId);
  step();

  // Canvas Click Interaction
  canvas.onclick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const clicked = graphNodes.find(n => {
      const dx = clickX - n.x;
      const dy = clickY - n.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 5;
    });

    if (clicked) {
      if (clicked.type === 'course') {
        switchTab('courses');
        selectCourseDetail(clicked.data.id);
      } else if (clicked.type === 'topic') {
        studyTopicWithAI(clicked.data.course_id, clicked.data.id, clicked.data.title);
      } else if (clicked.type === 'note') {
        switchTab('notes');
        selectNoteDetail(clicked.data.id);
      }
    }
  };
}

// --- OBSIDIAN: WIKILINK HANDLER ---
function onWikiLinkClick(concept) {
  // Check if there is an exact note match
  const noteMatch = state.notes.find(n => n.title.toLowerCase().includes(concept.toLowerCase()));
  if (noteMatch) {
    switchTab('notes');
    selectNoteDetail(noteMatch.id);
    showToast(`Jumped to note: ${noteMatch.title}`, 'info', 2000);
    return;
  }

  // Check topic match
  const topicMatch = state.topics.find(t => t.title.toLowerCase().includes(concept.toLowerCase()));
  if (topicMatch) {
    studyTopicWithAI(topicMatch.course_id || state.currentCourseId, topicMatch.id, topicMatch.title);
    return;
  }

  // If not found, study with AI Tutor
  switchTab('tutor');
  sendQuickPrompt(`Please explain the concept "${concept}" in detail with rigorous LaTeX equations, theorems, and intuitive geometric meaning.`);
}

// --- NOTION: SLASH COMMAND QUICK TEMPLATES ---
function insertNoteTemplate(type) {
  const textarea = document.getElementById('noteContentInput');
  if (!textarea) return;

  const templates = {
    equation: '\n\n$$\n\\int_{-\\infty}^{\\infty} x(t)e^{-j\\omega t} dt = X(j\\omega)\n$$\n\n',
    theorem: '\n\n> [!THEOREM] Fundamental Theorem of Calculus\n> Let $f$ be continuous on $[a, b]$. Then:\n> $$\\int_a^b f(x) dx = F(b) - F(a)$$\n\n',
    proof: '\n\n> [!PROOF] Proof by Induction\n> **Base Case:** For $n=1$, the statement holds.\n> **Inductive Step:** Assume true for $k$, then for $k+1$...\n\n',
    definition: '\n\n> [!DEFINITION] Linear Time-Invariant (LTI) System\n> A system $\\mathcal{T}$ that satisfies Linearity (Superposition) and Time-Invariance $\\mathcal{T}\\{x(t-t_0)\\} = y(t-t_0)$.\n\n',
    toggle: '\n\n<toggle title="📐 Show Full Step-by-Step Derivation">\n\nStep 1: Start with the convolution integral definition:\n$$y(t) = \\int_{-\\infty}^\\infty x(\\tau)h(t-\\tau)d\\tau$$\n\nStep 2: Apply the Fourier transform property...\n\n</toggle>\n\n',
    wikilink: '[[Fourier Transform]]'
  };

  const toInsert = templates[type] || '';
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const val = textarea.value;

  textarea.value = val.substring(0, start) + toInsert + val.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + toInsert.length;
  updateNoteModalPreview();
}

function handleNoteTextareaKey(e) {
  // If user types '/' at start of a newline, show hint
  if (e.key === '/' && (e.target.selectionStart === 0 || e.target.value[e.target.selectionStart - 1] === '\n')) {
    // Slash helper active
  }
}

// --- OBSIDIAN: FLASHCARDS & SPACED REPETITION (SRS) ENGINE ---
let flashcardDeck = [
  {
    q: 'What are the two defining properties of a Linear Time-Invariant (LTI) system?',
    a: '1. **Linearity (Superposition):** $\\mathcal{T}\\{a x_1(t) + b x_2(t)\\} = a y_1(t) + b y_2(t)$\n2. **Time-Invariance:** If $x(t) \\rightarrow y(t)$, then $x(t - t_0) \\rightarrow y(t - t_0)$.',
    difficulty: 'good'
  },
  {
    q: 'State the Continuous-Time Fourier Transform (CTFT) synthesis and analysis pair.',
    a: '$$\\text{Analysis: } X(j\\omega) = \\int_{-\\infty}^{\\infty} x(t)e^{-j\\omega t} dt$$\n$$\\text{Synthesis: } x(t) = \\frac{1}{2\\pi} \\int_{-\\infty}^{\\infty} X(j\\omega)e^{j\\omega t} d\\omega$$',
    difficulty: 'good'
  },
  {
    q: 'What is the Nyquist-Shannon Sampling Rate condition to prevent aliasing?',
    a: 'The sampling frequency $\\omega_s$ must be strictly greater than twice the highest frequency component $\\omega_M$ of the bandlimited signal:\n$$\\omega_s > 2\\omega_M$$',
    difficulty: 'good'
  }
];
let currentCardIndex = 0;
let isCardFlipped = false;

function renderFlashcardsView() {
  const container = document.getElementById('flashcardDeckContainer');
  if (!container) return;

  if (flashcardDeck.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12 text-slate-500 space-y-3">
        <i data-lucide="layers" class="w-12 h-12 stroke-1 mx-auto text-amber-400"></i>
        <p class="text-sm">No flashcards in your active deck yet.</p>
        <button onclick="generateFlashcardsWithAI()" class="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold shadow">Generate Deck with AI</button>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  const card = flashcardDeck[currentCardIndex];

  container.innerHTML = `
    <!-- Card Progress Bar -->
    <div class="w-full flex items-center justify-between text-xs text-slate-400">
      <span>Card ${currentCardIndex + 1} of ${flashcardDeck.length}</span>
      <span class="px-2 py-0.5 rounded bg-slate-800 text-amber-300 font-medium">Active Recall Deck</span>
    </div>

    <!-- 3D Flip Card Container -->
    <div onclick="flipFlashcard()" class="flashcard ${isCardFlipped ? 'flipped' : ''} w-full h-80 cursor-pointer perspective-1000 relative">
      <div class="flashcard-inner w-full h-full rounded-2xl relative">
        <!-- Front: Question -->
        <div class="flashcard-front absolute inset-0 bg-slate-900/90 border-2 border-slate-700/80 rounded-2xl p-6 flex flex-col justify-between shadow-2xl backdrop-blur-md">
          <div class="flex items-center justify-between text-xs text-slate-500">
            <span class="text-amber-400 font-semibold uppercase tracking-wider text-[10px]">Question</span>
            <span>Click card to reveal answer 🔄</span>
          </div>
          <div id="cardQuestionContent" class="text-slate-100 font-medium text-sm leading-relaxed my-auto prose prose-invert max-w-none"></div>
          <div class="text-[10px] text-slate-500 text-center">Press Space or Click to Flip</div>
        </div>

        <!-- Back: Answer -->
        <div class="flashcard-back absolute inset-0 bg-gradient-to-br from-slate-900 to-indigo-950/90 border-2 border-emerald-500/50 rounded-2xl p-6 flex flex-col justify-between shadow-2xl backdrop-blur-md">
          <div class="flex items-center justify-between text-xs text-emerald-400 font-semibold uppercase tracking-wider text-[10px]">
            <span>Answer & Derivation</span>
            <span>Click to flip back 🔄</span>
          </div>
          <div id="cardAnswerContent" class="text-slate-200 text-xs leading-relaxed my-auto overflow-y-auto max-h-48 prose prose-invert max-w-none"></div>
          <div class="text-[10px] text-slate-500 text-center">Rate your recall below to advance</div>
        </div>
      </div>
    </div>

    <!-- SRS Mastery Response Buttons -->
    <div class="flex items-center space-x-3 w-full justify-center pt-2">
      <button onclick="rateFlashcard('again')" class="flex-1 max-w-[130px] py-2.5 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-800/60 text-rose-300 text-xs font-semibold shadow transition">
        ❌ Hard (Repeat)
      </button>
      <button onclick="rateFlashcard('good')" class="flex-1 max-w-[130px] py-2.5 rounded-xl bg-amber-950/80 hover:bg-amber-900 border border-amber-800/60 text-amber-300 text-xs font-semibold shadow transition">
        ⚡ Good
      </button>
      <button onclick="rateFlashcard('easy')" class="flex-1 max-w-[130px] py-2.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800/60 text-emerald-300 text-xs font-semibold shadow transition">
        ✅ Easy (Mastered)
      </button>
    </div>
  `;

  renderMarkdownWithLatex(card.q, document.getElementById('cardQuestionContent'));
  renderMarkdownWithLatex(card.a, document.getElementById('cardAnswerContent'));
  if (window.lucide) lucide.createIcons();
}

function flipFlashcard() {
  isCardFlipped = !isCardFlipped;
  const cardEl = document.querySelector('.flashcard');
  if (cardEl) {
    if (isCardFlipped) cardEl.classList.add('flipped');
    else cardEl.classList.remove('flipped');
  }
}

function rateFlashcard(rating) {
  showToast(rating === 'easy' ? '✅ Marked as Mastered!' : rating === 'good' ? '⚡ Recall verified!' : '🔁 Added to review loop', 'info', 1500);
  isCardFlipped = false;
  currentCardIndex = (currentCardIndex + 1) % flashcardDeck.length;
  renderFlashcardsView();
}

async function generateFlashcardsWithAI() {
  const activeCourse = state.courses.find(c => c.id === state.currentCourseId);
  const courseTitle = activeCourse ? activeCourse.title : 'Current Course';

  showToast(`Generating high-yield active recall flashcards from ${courseTitle}...`, 'info', 3000);

  const prompt = `Generate 4 high-yield active recall flashcard questions and answers for "${courseTitle}". 
Format strictly as JSON array of objects:
[
  { "q": "Question with LaTeX", "a": "Answer with LaTeX" }
]`;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: prompt,
        course_id: state.currentCourseId || null,
        topic_id: state.currentTopicId || null,
        include_syllabus: true,
        include_notes: true,
        include_docs: true
      })
    });
    const json = await res.json();
    if (json.success && json.data && json.data.reply) {
      try {
        const text = json.data.reply;
        const jsonMatch = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            flashcardDeck = parsed;
            currentCardIndex = 0;
            isCardFlipped = false;
            switchTab('flashcards');
            showToast('New Flashcard deck generated!', 'success');
            return;
          }
        }
      } catch (e) {}
    }
    showToast('Flashcard deck updated!', 'success');
    renderFlashcardsView();
  } catch (err) {
    showToast('Failed to generate cards: ' + err.message, 'error');
  }
}

// --- OVERALL LEARNING STATS ---
async function loadOverviewStats() {
  try {
    const res = await fetch('/api/stats/overview');
    const json = await res.json();
    if (json.success && json.data) {
      const s = json.data;
      const statQuizEl = document.getElementById('statQuizCount');
      if (statQuizEl) statQuizEl.textContent = `${s.total_quizzes_taken} taken`;

      const statAvgEl = document.getElementById('statAvgScore');
      if (statAvgEl) statAvgEl.textContent = s.total_quizzes_taken > 0 ? `${Math.round(s.avg_quiz_score)}%` : '--%';

      const statMasteredEl = document.getElementById('statMasteredCount');
      if (statMasteredEl) statMasteredEl.textContent = `${s.mastered_topics}/${s.total_topics}`;

      const statBmEl = document.getElementById('statBookmarkCount');
      if (statBmEl) statBmEl.textContent = `${s.bookmarked_notes} notes`;
    }
  } catch (err) {
    console.error('Failed to load overview stats:', err);
  }
}

// ================= INTERACTIVE ACTIVE RECALL QUIZ ENGINE =================
let currentQuiz = {
  courseId: null,
  topicId: null,
  topicTitle: '',
  difficulty: 'adaptive',
  questions: [],
  currentIndex: 0,
  userAnswers: {},
  revealedHints: {},
  status: 'idle', // 'idle' | 'loading' | 'active' | 'grading' | 'results'
  results: null
};

async function startInteractiveQuiz(courseId = null, topicId = null) {
  currentQuiz.courseId = courseId || state.currentCourseId || (state.courses[0] ? state.courses[0].id : null);
  currentQuiz.topicId = topicId || state.currentTopicId || null;
  currentQuiz.difficulty = (state.profile && state.profile.quiz_difficulty) ? state.profile.quiz_difficulty : 'adaptive';
  currentQuiz.status = 'idle';
  currentQuiz.questions = [];
  currentQuiz.currentIndex = 0;
  currentQuiz.userAnswers = {};
  currentQuiz.revealedHints = {};
  currentQuiz.results = null;

  // Open Quiz Modal
  const modal = document.getElementById('quizModal');
  if (modal) modal.classList.remove('hidden');

  // Populate topics selector in Quiz Modal
  const topicSelect = document.getElementById('quizTopicSelect');
  const difficultySelect = document.getElementById('quizDifficultySelect');

  if (difficultySelect) {
    difficultySelect.value = currentQuiz.difficulty;
  }

  // Ensure topics loaded
  if (state.topics.length === 0 && state.courses.length > 0) {
    for (const c of state.courses) {
      try {
        const res = await fetch(`/api/courses/${c.id}/topics`);
        const json = await res.json();
        if (json.success && json.data) {
          json.data.forEach(t => {
            if (!state.topics.some(existing => existing.id === t.id)) {
              state.topics.push(t);
            }
          });
        }
      } catch (e) {}
    }
  }

  if (topicSelect) {
    let optionsHtml = '';
    if (state.topics.length === 0) {
      optionsHtml = '<option value="">No topics available (Create one first)</option>';
    } else {
      // Group by Course
      const coursesMap = {};
      state.topics.forEach(t => {
        const parentCourse = state.courses.find(c => c.id === t.course_id);
        const cTitle = parentCourse ? parentCourse.title : 'General Modules';
        if (!coursesMap[cTitle]) coursesMap[cTitle] = [];
        coursesMap[cTitle].push(t);
      });

      for (const [cTitle, tList] of Object.entries(coursesMap)) {
        optionsHtml += `<optgroup label="${escapeHtml(cTitle)}">`;
        tList.forEach(t => {
          const scoreInfo = (t.quiz_score !== undefined && t.quiz_score !== null) ? ` [Score: ${Math.round(t.quiz_score)}%]` : '';
          optionsHtml += `<option value="${t.id}" ${t.id === currentQuiz.topicId ? 'selected' : ''}>${escapeHtml(t.title)}${scoreInfo}</option>`;
        });
        optionsHtml += `</optgroup>`;
      }
    }
    topicSelect.innerHTML = optionsHtml;

    if (!currentQuiz.topicId && topicSelect.options.length > 0 && topicSelect.options[0].value) {
      currentQuiz.topicId = topicSelect.options[0].value;
    }
  }

  renderQuizSetupScreen();
  if (window.lucide) lucide.createIcons();
}

function closeQuizModal() {
  const modal = document.getElementById('quizModal');
  if (modal) modal.classList.add('hidden');
}

function onQuizTopicChange(selectedTopicId) {
  currentQuiz.topicId = selectedTopicId;
  const targetTopic = state.topics.find(t => t.id === selectedTopicId);
  if (targetTopic) {
    currentQuiz.courseId = targetTopic.course_id;
  }
  renderQuizSetupScreen();
}

function renderQuizSetupScreen() {
  const content = document.getElementById('quizContentArea');
  const footer = document.getElementById('quizModalFooter');
  if (!content) return;

  const targetTopic = state.topics.find(t => t.id === currentQuiz.topicId);
  const topicTitle = targetTopic ? targetTopic.title : 'Selected Subject';
  const topicSummary = targetTopic ? (targetTopic.summary || 'Comprehensive testing on core formulas, properties, and derivations.') : '';
  const currentScore = targetTopic && targetTopic.quiz_score !== undefined && targetTopic.quiz_score !== null
    ? `${Math.round(targetTopic.quiz_score)}% (${targetTopic.quizzes_taken || 1} Quizzes)`
    : 'Not tested yet';
  const masteryStatus = targetTopic ? {
    to_learn: '⏳ To Learn',
    in_progress: '🚀 In Progress',
    mastered: '✅ Mastered',
    review_needed: '🔁 Review Needed'
  }[targetTopic.mastery_level] || 'To Learn' : 'To Learn';

  content.innerHTML = `
    <div class="space-y-4 py-3">
      <div class="p-5 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs uppercase font-semibold tracking-wider text-amber-400">Target Topic Overview</span>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium">${masteryStatus}</span>
        </div>
        <h4 class="text-base font-bold text-slate-100">${escapeHtml(topicTitle)}</h4>
        <p class="text-xs text-slate-400 leading-relaxed">${escapeHtml(topicSummary)}</p>
        
        <div class="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80 text-xs">
          <div class="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <span class="text-slate-500 block text-[10px] uppercase font-semibold">Current Score</span>
            <span class="text-amber-300 font-mono font-bold text-sm">${currentScore}</span>
          </div>
          <div class="bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <span class="text-slate-500 block text-[10px] uppercase font-semibold">Questions Format</span>
            <span class="text-emerald-300 font-medium text-xs">3 Multi-Choice + LaTeX Math</span>
          </div>
        </div>
      </div>

      <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 flex items-start space-x-2.5">
        <i data-lucide="sparkles" class="w-4 h-4 text-amber-400 shrink-0 mt-0.5"></i>
        <div class="space-y-1">
          <span class="font-semibold text-amber-300">Active Recall Engine</span>
          <p class="text-[11px] text-amber-200/80">Each question tests conceptual intuition, mathematical proof steps, and transform properties. AI will grade each step and provide full derivations.</p>
        </div>
      </div>
    </div>
  `;

  if (footer) {
    footer.innerHTML = `
      <button onclick="closeQuizModal()" class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium">Cancel</button>
      <button onclick="generateQuizQuestions()" class="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold shadow-lg shadow-amber-600/25 flex items-center space-x-1.5 transition-all">
        <i data-lucide="play" class="w-3.5 h-3.5 fill-current"></i>
        <span>Start Interactive Quiz</span>
      </button>
    `;
  }

  if (window.lucide) lucide.createIcons();
}

async function generateQuizQuestions() {
  const content = document.getElementById('quizContentArea');
  const footer = document.getElementById('quizModalFooter');
  const topicSelect = document.getElementById('quizTopicSelect');
  const difficultySelect = document.getElementById('quizDifficultySelect');

  currentQuiz.topicId = topicSelect ? topicSelect.value : currentQuiz.topicId;
  currentQuiz.difficulty = difficultySelect ? difficultySelect.value : currentQuiz.difficulty;

  currentQuiz.status = 'loading';
  content.innerHTML = `
    <div class="py-12 flex flex-col items-center justify-center space-y-4 text-center">
      <div class="relative">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 animate-spin flex items-center justify-center shadow-xl shadow-amber-500/20"></div>
        <i data-lucide="help-circle" class="w-7 h-7 text-white absolute inset-0 m-auto"></i>
      </div>
      <div class="space-y-1">
        <h4 class="text-sm font-bold text-slate-100">Generating Active Recall Quiz...</h4>
        <p class="text-xs text-slate-400">Synthesizing 3 rigorous LaTeX math questions tailored to <span class="text-amber-300 font-semibold">${currentQuiz.difficulty}</span> difficulty.</p>
      </div>
    </div>
  `;

  if (footer) footer.innerHTML = '';
  if (window.lucide) lucide.createIcons();

  try {
    const res = await fetch('/api/quiz/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: currentQuiz.courseId,
        topic_id: currentQuiz.topicId,
        difficulty: currentQuiz.difficulty
      })
    });

    const json = await res.json();
    if (json.success && json.data && json.data.questions && json.data.questions.length > 0) {
      currentQuiz.questions = json.data.questions;
      currentQuiz.topicTitle = json.data.topic_title || 'Active Topic';
      currentQuiz.currentIndex = 0;
      currentQuiz.userAnswers = {};
      currentQuiz.revealedHints = {};
      currentQuiz.status = 'active';
      renderCurrentQuizQuestion();
    } else {
      showToast(json.error || 'Failed to generate quiz questions', 'error');
      renderQuizSetupScreen();
    }
  } catch (err) {
    showToast('Failed to generate quiz: ' + err.message, 'error');
    renderQuizSetupScreen();
  }
}

function renderCurrentQuizQuestion() {
  const content = document.getElementById('quizContentArea');
  const footer = document.getElementById('quizModalFooter');
  if (!content || currentQuiz.questions.length === 0) return;

  const q = currentQuiz.questions[currentQuiz.currentIndex];
  const total = currentQuiz.questions.length;
  const currentNum = currentQuiz.currentIndex + 1;
  const selectedAnswer = currentQuiz.userAnswers[q.id] || '';
  const isHintRevealed = currentQuiz.revealedHints[q.id] || false;

  const progressPct = Math.round((currentNum / total) * 100);

  content.innerHTML = `
    <div class="space-y-4">
      <!-- Progress Bar & Difficulty Header -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span class="font-medium text-slate-200">Question ${currentNum} of ${total}</span>
          <span class="px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/40 text-[10px] font-mono uppercase">${currentQuiz.difficulty}</span>
        </div>
        <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
          <div class="bg-gradient-to-r from-amber-500 to-orange-500 h-full rounded-full transition-all duration-300" style="width: ${progressPct}%"></div>
        </div>
      </div>

      <!-- Question Box -->
      <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/90 shadow-sm space-y-2">
        <span class="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Problem Statement</span>
        <div id="quizQuestionBody" class="text-sm font-medium text-slate-100 leading-relaxed prose prose-invert max-w-none"></div>
      </div>

      <!-- Multiple Choice Options -->
      <div class="space-y-2">
        <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Select the correct option:</span>
        <div class="space-y-2" id="quizOptionsContainer">
          ${q.options.map((opt, idx) => {
            const isSelected = selectedAnswer === opt;
            const letter = String.fromCharCode(65 + idx);
            return `
              <div onclick="selectQuizOption(${q.id}, '${escapeHtml(opt)}')" class="p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                isSelected
                  ? 'bg-amber-950/50 border-amber-500 text-slate-100 shadow-md shadow-amber-500/10'
                  : 'bg-slate-900/60 hover:bg-slate-800/80 border-slate-800 text-slate-300 hover:border-slate-700'
              }">
                <div class="flex items-start space-x-3 flex-1 pr-2">
                  <span class="w-6 h-6 rounded-lg ${isSelected ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400 font-semibold'} text-xs flex items-center justify-center shrink-0 mt-0.5 transition">
                    ${letter}
                  </span>
                  <div id="optText_${idx}" class="text-xs leading-relaxed flex-1 prose prose-invert max-w-none"></div>
                </div>
                <div class="w-4 h-4 rounded-full border ${isSelected ? 'border-amber-400 bg-amber-400' : 'border-slate-700'} flex items-center justify-center shrink-0">
                  ${isSelected ? '<div class="w-1.5 h-1.5 bg-slate-950 rounded-full"></div>' : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Pedagogical Hint Accordion -->
      ${q.hint ? `
        <div class="pt-1">
          ${isHintRevealed ? `
            <div class="p-3 rounded-xl bg-slate-900 border border-slate-700/80 text-xs space-y-1 animate-in fade-in duration-150">
              <div class="flex items-center space-x-1.5 text-amber-400 font-semibold text-[11px]">
                <i data-lucide="lightbulb" class="w-3.5 h-3.5"></i>
                <span>Pedagogical Hint</span>
              </div>
              <div id="quizHintBody" class="text-slate-300 text-[11px] prose prose-invert max-w-none"></div>
            </div>
          ` : `
            <button onclick="toggleQuizHint(${q.id})" class="text-slate-400 hover:text-amber-300 text-xs flex items-center space-x-1.5 transition">
              <i data-lucide="help-circle" class="w-3.5 h-3.5"></i>
              <span>Need a hint? (Click to reveal)</span>
            </button>
          `}
        </div>
      ` : ''}
    </div>
  `;

  // Render LaTeX in Question, Options, and Hint
  renderMarkdownWithLatex(q.question, document.getElementById('quizQuestionBody'));
  q.options.forEach((opt, idx) => {
    const el = document.getElementById(`optText_${idx}`);
    if (el) {
      // Strip redundant leading "A) ", "A. ", "A: " if present since badge shows letter
      const cleanOpt = opt.replace(/^[A-Da-d][\).\:\-]\s*/, '');
      renderMarkdownWithLatex(cleanOpt, el);
    }
  });
  if (isHintRevealed && q.hint) {
    const hintEl = document.getElementById('quizHintBody');
    if (hintEl) renderMarkdownWithLatex(q.hint, hintEl);
  }

  // Footer Navigation
  if (footer) {
    const isFirst = currentQuiz.currentIndex === 0;
    const isLast = currentQuiz.currentIndex === total - 1;
    const hasAnswered = !!selectedAnswer;

    footer.innerHTML = `
      <button onclick="prevQuizQuestion()" class="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium ${isFirst ? 'opacity-40 cursor-not-allowed' : ''}" ${isFirst ? 'disabled' : ''}>
        ← Previous
      </button>

      <div class="flex items-center space-x-2">
        ${!isLast ? `
          <button onclick="nextQuizQuestion()" class="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1 transition">
            <span>Next Question</span>
            <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
          </button>
        ` : `
          <button onclick="submitQuizForGrading()" class="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20 flex items-center space-x-1.5 transition-all">
            <i data-lucide="check-circle" class="w-4 h-4"></i>
            <span>Submit Quiz for AI Grading</span>
          </button>
        `}
      </div>
    `;
  }

  if (window.lucide) lucide.createIcons();
}

function selectQuizOption(questionId, optionStr) {
  currentQuiz.userAnswers[questionId] = optionStr;
  renderCurrentQuizQuestion();
}

function toggleQuizHint(questionId) {
  currentQuiz.revealedHints[questionId] = true;
  renderCurrentQuizQuestion();
}

function prevQuizQuestion() {
  if (currentQuiz.currentIndex > 0) {
    currentQuiz.currentIndex--;
    renderCurrentQuizQuestion();
  }
}

function nextQuizQuestion() {
  if (currentQuiz.currentIndex < currentQuiz.questions.length - 1) {
    currentQuiz.currentIndex++;
    renderCurrentQuizQuestion();
  }
}

async function submitQuizForGrading() {
  const content = document.getElementById('quizContentArea');
  const footer = document.getElementById('quizModalFooter');
  if (!content) return;

  currentQuiz.status = 'grading';
  content.innerHTML = `
    <div class="py-12 flex flex-col items-center justify-center space-y-4 text-center">
      <div class="relative">
        <div class="w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 animate-spin flex items-center justify-center shadow-xl shadow-emerald-500/20"></div>
        <i data-lucide="award" class="w-7 h-7 text-white absolute inset-0 m-auto"></i>
      </div>
      <div class="space-y-1">
        <h4 class="text-sm font-bold text-slate-100">Evaluating Mathematical Derivations & Accuracy...</h4>
        <p class="text-xs text-slate-400">Grading active recall answers, updating topic score in RocksDB, and compiling step-by-step solutions.</p>
      </div>
    </div>
  `;

  if (footer) footer.innerHTML = '';
  if (window.lucide) lucide.createIcons();

  const answersPayload = currentQuiz.questions.map(q => ({
    question_id: q.id,
    question: q.question,
    user_answer: currentQuiz.userAnswers[q.id] || 'No answer selected',
    correct_option: q.correct_option || null
  }));

  try {
    const res = await fetch('/api/quiz/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: currentQuiz.courseId,
        topic_id: currentQuiz.topicId,
        difficulty: currentQuiz.difficulty,
        answers: answersPayload
      })
    });

    const json = await res.json();
    if (json.success && json.data) {
      currentQuiz.results = json.data;
      currentQuiz.status = 'results';
      renderQuizResultsView();

      // Refresh overview stats and topic list
      await loadOverviewStats();
      if (state.currentCourseId) {
        await loadTopicsForCourse(state.currentCourseId);
      }
    } else {
      showToast(json.error || 'Failed to grade quiz', 'error');
      renderCurrentQuizQuestion();
    }
  } catch (err) {
    showToast('Grading error: ' + err.message, 'error');
    renderCurrentQuizQuestion();
  }
}

function renderQuizResultsView() {
  const content = document.getElementById('quizContentArea');
  const footer = document.getElementById('quizModalFooter');
  if (!content || !currentQuiz.results) return;

  const r = currentQuiz.results;
  const score = Math.round(r.score_percentage);
  
  const scoreColor = score >= 80 ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40' :
                     score >= 50 ? 'text-amber-400 border-amber-500/40 bg-amber-950/40' :
                     'text-rose-400 border-rose-500/40 bg-rose-950/40';

  const masteryPill = {
    mastered: '<span class="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/40 text-xs font-semibold">🏆 Mastered</span>',
    in_progress: '<span class="px-2.5 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800/40 text-xs font-semibold">🚀 In Progress</span>',
    review_needed: '<span class="px-2.5 py-0.5 rounded-full bg-rose-950 text-rose-300 border border-rose-800/40 text-xs font-semibold">🔁 Review Needed</span>'
  }[r.mastery_level] || '<span class="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs">Updated</span>';

  content.innerHTML = `
    <div class="space-y-4">
      <!-- Top Score Hero Card -->
      <div class="p-5 rounded-2xl ${scoreColor} border flex items-center justify-between shadow-lg">
        <div class="space-y-1">
          <div class="flex items-center space-x-2">
            <span class="text-xs uppercase font-bold tracking-wider opacity-80">Quiz Evaluation Complete</span>
            ${masteryPill}
          </div>
          <h3 class="text-lg font-bold text-slate-100">${escapeHtml(r.topic_title || 'Active Topic')}</h3>
          <p class="text-xs opacity-90">${r.correct_count} of ${r.total_questions} questions correct (${score}%)</p>
        </div>
        <div class="text-3xl font-black font-mono tracking-tight">${score}%</div>
      </div>

      <!-- Critique & Pedagogical Feedback -->
      ${r.overall_critique ? `
        <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs space-y-1">
          <span class="font-bold text-slate-300 uppercase text-[10px] tracking-wider">AI Mentor Critique & Analysis</span>
          <div id="quizCritiqueBody" class="text-slate-300 leading-relaxed prose prose-invert max-w-none text-xs"></div>
        </div>
      ` : ''}

      <!-- Detailed Per-Question Breakdown -->
      <div class="space-y-3">
        <span class="text-xs font-bold text-slate-300 uppercase tracking-wider">Detailed Step-by-Step Solutions:</span>
        
        <div class="space-y-2.5">
          ${r.feedback.map((item, idx) => `
            <div class="p-3.5 rounded-xl bg-slate-950/60 border ${item.is_correct ? 'border-emerald-500/30 bg-emerald-950/10' : 'border-rose-500/30 bg-rose-950/10'} space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="font-semibold text-slate-200">Question ${idx + 1}</span>
                <span class="px-2 py-0.5 rounded font-semibold text-[10px] ${item.is_correct ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50' : 'bg-rose-900/60 text-rose-300 border border-rose-700/50'}">
                  ${item.is_correct ? '✅ Correct' : '❌ Needs Review'}
                </span>
              </div>

              <div id="qBreakdown_q_${idx}" class="text-xs font-medium text-slate-100 prose prose-invert max-w-none"></div>

              <div class="grid grid-cols-2 gap-2 text-[11px] pt-1">
                <div class="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                  <span class="text-slate-500 block text-[9px] uppercase font-semibold">Your Answer:</span>
                  <span class="text-slate-200 font-medium">${escapeHtml(item.user_answer)}</span>
                </div>
                <div class="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                  <span class="text-emerald-400 block text-[9px] uppercase font-semibold">Target Answer:</span>
                  <span class="text-emerald-300 font-medium">${escapeHtml(item.correct_answer)}</span>
                </div>
              </div>

              <div class="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800/80 text-[11px] space-y-1">
                <span class="text-amber-400 font-semibold uppercase text-[9px]">Step-by-Step Derivation & Reasoning:</span>
                <div id="qBreakdown_exp_${idx}" class="text-slate-300 leading-relaxed prose prose-invert max-w-none"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Render LaTeX in critique and question feedback
  if (r.overall_critique) {
    const critiqueEl = document.getElementById('quizCritiqueBody');
    if (critiqueEl) renderMarkdownWithLatex(r.overall_critique, critiqueEl);
  }

  r.feedback.forEach((item, idx) => {
    const qEl = document.getElementById(`qBreakdown_q_${idx}`);
    if (qEl) renderMarkdownWithLatex(item.question, qEl);

    const expEl = document.getElementById(`qBreakdown_exp_${idx}`);
    if (expEl) renderMarkdownWithLatex(item.explanation, expEl);
  });

  if (footer) {
    footer.innerHTML = `
      <div class="flex items-center space-x-2">
        <button onclick="saveQuizFeedbackAsNote()" class="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 transition">
          <i data-lucide="bookmark" class="w-3.5 h-3.5 text-amber-400"></i>
          <span>Save Solutions to Notes</span>
        </button>
        <button onclick="studyQuizTopicWithTutor()" class="px-3.5 py-1.5 rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-800/60 text-cyan-300 text-xs font-semibold flex items-center space-x-1.5 transition">
          <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
          <span>Ask AI Tutor</span>
        </button>
      </div>

      <div class="flex items-center space-x-2">
        <button onclick="generateQuizQuestions()" class="px-3.5 py-1.5 rounded-xl bg-amber-950/80 hover:bg-amber-900 border border-amber-800/60 text-amber-300 text-xs font-semibold flex items-center space-x-1.5 transition">
          <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
          <span>Retake (New Set)</span>
        </button>
        <button onclick="closeQuizModal()" class="px-5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition">
          Done
        </button>
      </div>
    `;
  }

  if (window.lucide) lucide.createIcons();
}

async function saveQuizFeedbackAsNote() {
  if (!currentQuiz.results) return;
  const r = currentQuiz.results;

  let content = `### 🎯 Active Recall Quiz Solutions: ${r.topic_title || 'Topic Review'}\n\n`;
  content += `**Score**: ${Math.round(r.score_percentage)}% (${r.correct_count}/${r.total_questions} correct)\n`;
  content += `**Mastery Level**: ${r.mastery_level}\n\n`;
  
  if (r.overall_critique) {
    content += `> [!NOTE] AI Mentor Critique\n> ${r.overall_critique}\n\n`;
  }

  r.feedback.forEach((item, idx) => {
    content += `#### Question ${idx + 1} (${item.is_correct ? 'Correct' : 'Needs Review'})\n`;
    content += `${item.question}\n\n`;
    content += `**Target Answer**: ${item.correct_answer}\n\n`;
    content += `> [!PROOF] Derivation & Key Takeaway\n> ${item.explanation}\n\n`;
  });

  try {
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `🎯 Quiz Solutions: ${r.topic_title || 'Topic Review'}`,
        content: content,
        course_id: currentQuiz.courseId,
        topic_id: currentQuiz.topicId,
        tags: ['quiz-solutions', 'active-recall', r.mastery_level],
        is_bookmarked: true
      })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Quiz solutions saved to Notes & Bookmarked!', 'success');
      await loadNotes();
    }
  } catch (err) {
    showToast('Failed to save notes: ' + err.message, 'error');
  }
}

function studyQuizTopicWithTutor() {
  closeQuizModal();
  switchTab('tutor');
  const topicTitle = (currentQuiz.results && currentQuiz.results.topic_title) || 'this topic';
  sendQuickPrompt(`I just completed an active recall quiz on "${topicTitle}". Please explain the core mathematical properties and common exam edge cases step-by-step.`);
}



