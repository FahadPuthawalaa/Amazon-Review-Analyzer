// ============================================================
// Amazon Review Analyzer Pro — popup.js
// Version: 2.0 — Full QA Pass
// ============================================================

(async () => {

  // ─── Constants (hardcoded payment details) ────────────────
  const PAYPAL_URL    = 'https://www.paypal.com/paypalme/fahadputhawala';
  const KOFI_URL      = 'https://ko-fi.com/fynxther';
  const UPI_ID        = 'puthawalafahad786@oksbi';
  const GEMINI_MODELS = [
    'gemini-2.5-flash-preview-05-20',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash-latest'
  ];

  // ─── State ───────────────────────────────────────────────
  let state = {
    apiKey:        '',
    selectedAmount: 5,
    selectedTone:  'professional',
    autoAnalyze:   false,
    productData:   null,
    isLoading:     false,
    activeModel:   null,
  };

  // ─── DOM Helpers ─────────────────────────────────────────
  const $  = id  => document.getElementById(id);
  const $$ = sel => document.querySelectorAll(sel);

  // ─── Load Settings ───────────────────────────────────────
  async function loadSettings() {
    return new Promise(resolve => {
      chrome.storage.local.get(['apiKey', 'autoAnalyze', 'defaultAnalysis', 'activeModel'], d => {
        state.apiKey      = d.apiKey      || '';
        state.autoAnalyze = d.autoAnalyze || false;
        state.activeModel = d.activeModel || null;
        if (d.defaultAnalysis) {
          const el = $('analysisType');
          if (el) el.value = d.defaultAnalysis;
        }
        resolve();
      });
    });
  }

  // ─── Init ────────────────────────────────────────────────
  async function init() {
    await loadSettings();
    $('upiIdText').textContent = UPI_ID;

    if (!state.apiKey) {
      showScreen('setup');
      updateStatus('Setup required', 'warning');
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url   = tab?.url || '';
    const isAmazon      = /amazon\.(com|in|co\.uk|de|fr|ca|com\.au)/i.test(url);
    const isProductPage = isAmazon && /\/dp\/|\/gp\/product\//i.test(url);

    if (!isAmazon) {
      showScreen('notAmazon');
      updateStatus('Not on Amazon', 'warning');
      return;
    }

    showScreen('analyzer');

    if (isProductPage) {
      updateStatus('Reading product data...', 'active');
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductData' });
        if (response) {
          state.productData = response;
          renderProductStrip(response);
          const rc = response.reviewCount;
          updateStatus(rc ? `${Number(rc).toLocaleString()} reviews found` : 'Product ready', 'active');
          if (state.autoAnalyze) runAnalysis();
        }
      } catch (e) {
        updateStatus('Ready — click Analyze', 'active');
      }
    } else {
      updateStatus('Navigate to a product page', 'warning');
    }
  }

  // ─── Screen Switcher ─────────────────────────────────────
  function showScreen(name) {
    ['setup', 'notAmazon', 'analyzer'].forEach(s => {
      $(`${s}Screen`)?.classList.toggle('hidden', s !== name);
    });
  }

  function updateStatus(text, type = '') {
    $('statusText').textContent = text;
    $('statusDot').className    = 'status-dot' + (type ? ` ${type}` : '');
  }

  // ─── Product Strip ───────────────────────────────────────
  function renderProductStrip(data) {
    $('productRating').textContent     = data.rating || '—';
    $('productTitleShort').textContent = data.title  || 'Product';
    $('reviewCount').textContent       = data.reviewCount
      ? `${Number(data.reviewCount).toLocaleString()} reviews`
      : '— reviews';
    $('productCategory').textContent   = data.category || 'Amazon';
  }

  // ─── Gemini API (with model fallback + error typing) ─────
  async function callGemini(prompt) {
    if (state.isLoading) return { error: 'Already processing. Please wait.' };
    state.isLoading = true;

    const modelsToTry = state.activeModel
      ? [state.activeModel, ...GEMINI_MODELS.filter(m => m !== state.activeModel)]
      : GEMINI_MODELS;

    try {
      for (const model of modelsToTry) {
        let response;
        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.apiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 1500, temperature: 0.4, topP: 0.9 }
              })
            }
          );
        } catch (netErr) {
          throw new Error('Network error — check your internet connection.');
        }

        if (response.status === 404 || response.status === 400) continue; // try next model

        if (response.status === 429) throw new Error('Rate limit reached. Wait a moment and try again.');
        if (response.status === 401 || response.status === 403)
          throw new Error('Invalid API key. Click ⚙️ Settings to update your Gemini key.');

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error?.message || `API error (${response.status})`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini returned an empty response. Please try again.');

        // Cache the working model
        if (state.activeModel !== model) {
          state.activeModel = model;
          chrome.storage.local.set({ activeModel: model });
        }
        return text;
      }

      throw new Error('No Gemini model available. Check your API key or try again later.');
    } catch (err) {
      return { error: err.message };
    } finally {
      state.isLoading = false;
    }
  }

  // ─── Inline Loading HTML ─────────────────────────────────
  function loadingHTML(msg = 'Analyzing...') {
    return `<div class="inline-loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">${escHtml(msg)}</div>
      <div class="loading-sub">Powered by Google Gemini</div>
    </div>`;
  }

  // ─── Inline Error HTML ───────────────────────────────────
  function errorHTML(msg) {
    return `<div class="ai-result-card error-card">
      <h4>⚠️ Error</h4>
      <p class="error-msg">${escHtml(msg)}</p>
      <p class="error-hint">${
        (msg.includes('API key') || msg.includes('401') || msg.includes('403'))
          ? 'Click ⚙️ Settings to update your Gemini API key.'
          : 'Please try again. If it keeps failing, check your API key.'
      }</p>
    </div>`;
  }

  // ─── Fetch product data helper ───────────────────────────
  async function ensureProductData() {
    if (state.productData) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      state.productData = await chrome.tabs.sendMessage(tab.id, { action: 'getProductData' });
    } catch (e) { /* proceed with null */ }
  }

  function buildReviewsText(filter = 'all') {
    const reviews = state.productData?.reviews || [];
    const filtered = filter === 'all' ? reviews : reviews.filter(r => r.rating == filter);
    return filtered.length
      ? filtered.map(r => `[${r.rating}★] ${r.title ? r.title + ': ' : ''}${r.body}`).join('\n')
      : 'No reviews extracted — provide a general analysis based on product context.';
  }

  // ─── TAB: Analyze ────────────────────────────────────────
  async function runAnalysis() {
    if (state.isLoading) { showToast('Analysis in progress…', 'warning'); return; }
    await ensureProductData();

    const type       = $('analysisType').value;
    const filter     = $('starFilter').value;
    const product    = state.productData?.title       || 'this Amazon product';
    const rating     = state.productData?.rating      || 'N/A';
    const totalRev   = state.productData?.reviewCount || 'unknown';
    const reviewsText = buildReviewsText(filter);

    const prompts = {
      sentiment: `You are an expert Amazon review analyst. Analyze these customer reviews for "${product}" (Rating: ${rating}/5, Reviews: ${totalRev}).

Reviews${filter !== 'all' ? ` (${filter}-star only)` : ''}:
${reviewsText}

Respond in EXACTLY this format:

SENTIMENT: {positive}%|{neutral}%|{negative}%

POSITIVES:
• [theme 1]
• [theme 2]
• [theme 3]

NEGATIVES:
• [theme 1]
• [theme 2]
• [theme 3]

VERDICT: [2-sentence actionable summary for the seller]`,

      complaints: `Analyze these Amazon reviews for "${product}" and identify the TOP 5 complaint themes.

${reviewsText}

Return ONLY 5 lines in this exact format:
THEME: [name]|[1-2 sentence description]|[Rare/Occasional/Common/Very Common]|[Low/Medium/High/Critical]`,

      keywords: `Extract impactful keywords from these Amazon reviews for "${product}":

${reviewsText}

Respond in this format:

TOP POSITIVE WORDS:
[word1], [word2], [word3], [word4], [word5], [word6], [word7], [word8], [word9], [word10]

TOP NEGATIVE WORDS:
[word1], [word2], [word3], [word4], [word5], [word6], [word7], [word8], [word9], [word10]

MOST MENTIONED FEATURES:
[feature1], [feature2], [feature3], [feature4], [feature5]

COMPETITOR MENTIONS:
[any competitors mentioned, or "None"]

OVERALL TONE: [one sentence]`,

      quality: `Analyze these Amazon reviews for "${product}" for quality signals:

${reviewsText}

Rate each and explain:

DEFECTS & FAILURES: [None/Low/Medium/High/Critical] — [explanation]
PACKAGING ISSUES: [None/Low/Medium/High/Critical] — [explanation]
LISTING ACCURACY: [None/Low/Medium/High/Critical] — [explanation]
DURABILITY CONCERNS: [None/Low/Medium/High/Critical] — [explanation]
SAFETY CONCERNS: [None/Low/Medium/High/Critical] — [explanation]
VALUE FOR MONEY: [Poor/Fair/Good/Excellent] — [explanation]

PRIORITY ACTION: [most important fix for the seller]`,

      compare: `Competitive intelligence for "${product}" based on reviews:

${reviewsText}

CUSTOMER WISH LIST:
• [what customers wish was better — 3 items]

COMPETITOR MENTIONS:
• [competitors mentioned and why customers prefer them]

UNIQUE ADVANTAGES:
• [what this product does better — 3 items]

PRICE-VALUE PERCEPTION: [one sentence]

MARKET OPPORTUNITY SCORE: [1-10] — [reason]`
    };

    const msgs = {
      sentiment:  'Analyzing sentiment patterns...',
      complaints: 'Identifying complaint themes...',
      keywords:   'Mining keywords & phrases...',
      quality:    'Scanning quality signals...',
      compare:    'Running competitive analysis...'
    };

    $('resultArea').innerHTML        = loadingHTML(msgs[type]);
    $('sentimentOverview').style.display = 'none';

    const result = await callGemini(prompts[type]);
    if (!result || result.error) { $('resultArea').innerHTML = errorHTML(result?.error || 'Unknown error'); return; }

    if (type === 'sentiment') renderSentiment(result);
    else renderGeneric(result, type);
  }

  // ─── Render: Sentiment ───────────────────────────────────
  function renderSentiment(text) {
    const m = text.match(/SENTIMENT:\s*(\d+)%\s*\|\s*(\d+)%\s*\|\s*(\d+)%/i);
    if (m) {
      let [, p, n, g] = m.map(Number);
      const sum = p + n + g;
      if (sum && sum !== 100) { p = Math.round(p/sum*100); n = Math.round(n/sum*100); g = 100-p-n; }
      const ov = $('sentimentOverview');
      ov.style.display = 'block';
      setTimeout(() => {
        $('posBar').style.width = p+'%'; $('posPct').textContent = p+'%';
        $('neuBar').style.width = n+'%'; $('neuPct').textContent = n+'%';
        $('negBar').style.width = g+'%'; $('negPct').textContent = g+'%';
      }, 80);
    }

    const parseList = raw => (raw||'').trim().split('\n')
      .map(l => l.replace(/^[\s•\-\*\d\.]+/, '').trim()).filter(l => l.length > 2);

    const pos     = parseList(text.match(/POSITIVES?:\s*([\s\S]*?)(?=NEGATIVES?:|VERDICT:|$)/i)?.[1]);
    const neg     = parseList(text.match(/NEGATIVES?:\s*([\s\S]*?)(?=VERDICT:|$)/i)?.[1]);
    const verdict = text.match(/VERDICT:\s*([\s\S]*?)$/i)?.[1]?.trim() || '';

    let html = '<div class="ai-result-card fade-in">';
    if (pos.length) html += `<h4>✅ What Customers Love</h4><ul>${pos.map(p=>`<li>${escHtml(p)}</li>`).join('')}</ul>`;
    if (neg.length) html += `<h4 style="margin-top:12px">❌ Customer Pain Points</h4><ul>${neg.map(n=>`<li>${escHtml(n)}</li>`).join('')}</ul>`;
    if (verdict)    html += `<div class="verdict-box"><div class="verdict-label">📋 Seller Verdict</div><div class="verdict-text">${escHtml(verdict)}</div></div>`;
    html += `<button class="export-btn" onclick="copyCard(this)">📋 Copy Results</button></div>`;
    $('resultArea').innerHTML = html;
  }

  // ─── Render: Generic ─────────────────────────────────────
  function renderGeneric(text, type) {
    const titles = { keywords:'🔑 Keyword Analysis', quality:'⚙️ Quality Assessment', compare:'📊 Competitive Intelligence' };
    const formatted = escHtml(text)
      .replace(/^([A-Z][A-Z &]+:)/gm, '<strong class="section-title">$1</strong>')
      .replace(/\n/g, '<br>');
    $('resultArea').innerHTML = `
      <div class="ai-result-card fade-in">
        <h4>${titles[type] || '📊 Results'}</h4>
        <div class="result-body">${formatted}</div>
        <button class="export-btn" onclick="copyCard(this)">📋 Copy Results</button>
      </div>`;
  }

  // ─── TAB: Complaints ─────────────────────────────────────
  async function loadComplaints() {
    if (state.isLoading) { showToast('Analysis in progress…', 'warning'); return; }
    await ensureProductData();

    const product = state.productData?.title || 'this Amazon product';
    const reviewsText = buildReviewsText('all');

    $('complaintsResult').innerHTML = loadingHTML('Extracting complaint themes...');

    const result = await callGemini(
      `You are a complaint intelligence expert for Amazon sellers. Analyze these reviews for "${product}":\n\n${reviewsText}\n\nIdentify exactly 5 recurring complaint themes. Return ONLY 5 lines:\nTHEME: [name]|[1-2 sentence description]|[Rare/Occasional/Common/Very Common]|[Low/Medium/High/Critical]`
    );

    if (!result || result.error) { $('complaintsResult').innerHTML = errorHTML(result?.error||'Unknown error'); return; }

    const themes = result.match(/THEME:.*$/gm) || [];
    if (!themes.length) {
      $('complaintsResult').innerHTML = `<div class="ai-result-card fade-in"><div class="result-body">${escHtml(result).replace(/\n/g,'<br>')}</div></div>`;
      return;
    }

    const sevColor = { Critical:'var(--negative)', High:'#f97316', Medium:'var(--neutral)', Low:'var(--accent)' };
    const sevIcon  = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🔵' };

    $('complaintsResult').innerHTML = '<div class="fade-in">' + themes.map((line, i) => {
      const [name, desc, freq, sev] = line.replace('THEME:','').split('|').map(p=>p.trim());
      const color = sevColor[sev] || 'var(--accent)';
      return `<div class="complaint-item" style="border-left-color:${color};animation-delay:${i*60}ms">
        <div class="complaint-theme">${sevIcon[sev]||'⚠️'} ${escHtml(name||'Issue')}</div>
        <div class="complaint-desc">${escHtml(desc||'')}</div>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="complaint-count">${escHtml(freq||'—')}</span>
          <span class="complaint-count" style="background:${color}22;color:${color}">${escHtml(sev||'—')} Severity</span>
        </div>
      </div>`;
    }).join('') + '</div>';
  }

  // ─── TAB: Insights ───────────────────────────────────────
  async function loadInsights() {
    if (state.isLoading) { showToast('Analysis in progress…', 'warning'); return; }
    await ensureProductData();

    const product = state.productData?.title  || 'this Amazon product';
    const rating  = state.productData?.rating || 'N/A';
    const reviewsText = buildReviewsText('all');

    $('insightsResult').innerHTML = loadingHTML('Generating seller action plan...');

    const result = await callGemini(
      `You are an expert Amazon business consultant. Analyze reviews for "${product}" (Rating: ${rating}/5).\n\n${reviewsText}\n\nGenerate exactly 5 high-impact seller action items. Return ONLY 5 lines:\nINSIGHT: [emoji] [title]|[2-3 sentence actionable recommendation with concrete steps]`
    );

    if (!result || result.error) { $('insightsResult').innerHTML = errorHTML(result?.error||'Unknown error'); return; }

    const insights = result.match(/INSIGHT:.*$/gm) || [];
    if (!insights.length) {
      $('insightsResult').innerHTML = `<div class="ai-result-card fade-in"><div class="result-body">${escHtml(result).replace(/\n/g,'<br>')}</div></div>`;
      return;
    }

    $('insightsResult').innerHTML = '<div class="fade-in">' + insights.map((line, i) => {
      const [titlePart, text] = line.replace('INSIGHT:','').split('|').map(p=>p.trim());
      const emojiMatch = titlePart?.match(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
      const emoji = emojiMatch ? emojiMatch[0] : '💡';
      const title = titlePart?.replace(/^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u,'') || 'Action Item';
      return `<div class="insight-card" style="animation-delay:${i*70}ms">
        <span class="insight-icon">${emoji}</span>
        <div class="insight-title">${escHtml(title)}</div>
        <div class="insight-text">${escHtml(text||'')}</div>
      </div>`;
    }).join('') + '</div>';
  }

  // ─── TAB: Reply Generator ────────────────────────────────
  async function generateReply() {
    if (state.isLoading) { showToast('Analysis in progress…', 'warning'); return; }

    const reviewText = $('reviewText').value.trim();
    if (!reviewText) { $('reviewText').focus(); showToast('Paste a customer review first', 'warning'); return; }

    const toneGuides = {
      professional: 'Write in a professional, solution-focused business tone.',
      empathetic:   'Lead with genuine empathy before offering a solution.',
      formal:       'Use formal, respectful language as in official correspondence.',
      friendly:     'Be warm and personable while remaining professional.'
    };

    const product = state.productData?.title || 'our product';
    const replyDiv = $('replyResult');

    replyDiv.innerHTML = loadingHTML('Crafting your response...');

    const result = await callGemini(
      `Write a public Amazon seller response to this review for "${product}".\n\nCustomer Review:\n"${reviewText}"\n\nTone: ${toneGuides[state.selectedTone]}\n\nRules:\n- Acknowledge the experience sincerely\n- Never argue or sound defensive\n- Offer a specific resolution (refund/replacement/contact)\n- Tell them to contact via Amazon messaging\n- End with genuine commitment to their satisfaction\n- Max 150 words\n- Do NOT start with "Dear Customer"\n- Sound like a real person\n- Output ONLY the response text, no labels or headers`
    );

    if (!result || result.error) {
      replyDiv.innerHTML = errorHTML(result?.error || 'Unknown error');
      return;
    }

    // Strip any AI preamble
    const cleaned = result
      .replace(/^(here'?s?\s+(a\s+)?|certainly[,!]?\s*|sure[,!]?\s*|of course[,!]?\s*|absolutely[,!]?\s*)[^:]*:\s*/i, '')
      .replace(/^response:\s*/i, '')
      .trim();

    replyDiv.innerHTML = `
      <div class="reply-result-inner fade-in">
        <div class="reply-toolbar">
          <span class="reply-word-count">${cleaned.split(/\s+/).length} words</span>
          <button class="copy-reply-btn" id="copyReplyBtn">📋 Copy</button>
        </div>
        <div class="reply-text-body">${escHtml(cleaned)}</div>
      </div>`;

    $('copyReplyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(cleaned).then(() => showToast('Response copied!'));
    });
  }

  // ─── Global copy helper ───────────────────────────────────
  window.copyCard = btn => {
    const card = btn.closest('.ai-result-card');
    const text = card ? card.innerText.replace('📋 Copy Results','').trim() : '';
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
  };

  // ─── Tab Navigation ──────────────────────────────────────
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  // ─── Tone Chips ──────────────────────────────────────────
  $$('.tone-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.tone-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.selectedTone = chip.dataset.tone;
    });
  });

  // ─── Donate Modal ────────────────────────────────────────
  $('donateBtn').addEventListener('click', () => {
    generateUpiQR(UPI_ID);
    $('donateModal').classList.remove('hidden');
  });
  $('closeDonate').addEventListener('click', () => $('donateModal').classList.add('hidden'));
  $('donateModal').addEventListener('click', e => { if (e.target === $('donateModal')) $('donateModal').classList.add('hidden'); });

  $$('.donate-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.donate-tab-btn').forEach(b => b.classList.remove('active'));
      $$('.donate-tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $(`dtab-${btn.dataset.dtab}`)?.classList.add('active');
    });
  });

  $$('.amount-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.amount-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.amount === 'custom') {
        $('customAmount').classList.remove('hidden');
        state.selectedAmount = null;
      } else {
        $('customAmount').classList.add('hidden');
        state.selectedAmount = parseInt(btn.dataset.amount);
      }
    });
  });

  $('paypalDonate').addEventListener('click', () => {
    const amount = state.selectedAmount || (parseInt($('customAmount').value) || 5);
    chrome.tabs.create({ url: `${PAYPAL_URL}/${amount}` });
  });

  $('copyUPI').addEventListener('click', () => {
    navigator.clipboard.writeText(UPI_ID).then(() => showToast('UPI ID copied!'));
  });

  // ─── UPI QR Code — qrcodejs (battle-tested, fully offline) ─
  function generateUpiQR(upiId) {
    const container = $('upiQRCode');
    if (!container) return;
    // UPI deep-link string — recognised by all Indian payment apps
    const upiString = `upi://pay?pa=${upiId}&pn=Fahad%20Puthawala&cu=INR`;
    try {
      container.innerHTML = ''; // clear previous
      new QRCode(container, {
        text:         upiString,
        width:        168,
        height:       168,
        colorDark:    '#000000',
        colorLight:   '#ffffff',
        correctLevel: QRErrorCorrectLevel.M
      });
      // Style the generated canvas
      const cv = container.querySelector('canvas');
      if (cv) cv.style.cssText = 'border-radius:8px;display:block;border:4px solid white';
    } catch (e) {
      container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-muted)">📱 Use UPI ID below to pay</div>';
    }
  }

  // ─── Settings Modal ──────────────────────────────────────
  $('settingsBtn').addEventListener('click', () => {
    $('settingsApiKey').value   = state.apiKey;
    $('autoAnalyze').checked    = state.autoAnalyze;
    $('settingsModal').classList.remove('hidden');
  });
  $('closeSettings').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('settingsModal').addEventListener('click', e => { if (e.target === $('settingsModal')) $('settingsModal').classList.add('hidden'); });

  ['toggleKey|apiKeyInput', 'toggleSettingsKey|settingsApiKey'].forEach(pair => {
    const [btnId, inputId] = pair.split('|');
    $(btnId)?.addEventListener('click', () => {
      const input = $(inputId);
      input.type = input.type === 'password' ? 'text' : 'password';
      $(btnId).textContent = input.type === 'password' ? '👁' : '🙈';
    });
  });

  $('saveSettings').addEventListener('click', () => {
    const newKey = $('settingsApiKey').value.trim();
    if (!newKey) { showToast('API key cannot be empty', 'error'); return; }
    const autoA  = $('autoAnalyze').checked;
    chrome.storage.local.set({ apiKey: newKey, autoAnalyze: autoA }, () => {
      state.apiKey      = newKey;
      state.autoAnalyze = autoA;
      state.activeModel = null;
      chrome.storage.local.remove('activeModel');
      $('settingsModal').classList.add('hidden');
      showToast('Settings saved!');
    });
  });

  $('clearData').addEventListener('click', () => {
    if (confirm('Remove your API key and all saved data?')) {
      chrome.storage.local.clear(() => { showToast('All data cleared'); setTimeout(() => location.reload(), 1200); });
    }
  });

  // ─── Setup Screen ────────────────────────────────────────
  function trySaveKey() {
    const key = $('apiKeyInput').value.trim();
    if (!key)              { showToast('Please enter your API key', 'error'); return; }
    if (!key.startsWith('AIza')) { showToast('Gemini keys start with "AIza"', 'error'); return; }
    chrome.storage.local.set({ apiKey: key }, () => {
      state.apiKey = key;
      showToast('Key saved! Loading...');
      setTimeout(() => init(), 900);
    });
  }
  $('saveApiKey').addEventListener('click', trySaveKey);
  $('apiKeyInput').addEventListener('keydown', e => { if (e.key === 'Enter') trySaveKey(); });

  // ─── Main Action Buttons ─────────────────────────────────
  $('analyzeBtn').addEventListener('click',        runAnalysis);
  $('loadComplaintsBtn').addEventListener('click', loadComplaints);
  $('loadInsightsBtn').addEventListener('click',   loadInsights);
  $('generateReplyBtn').addEventListener('click',  generateReply);

  // ─── Toast ───────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    $$('.success-toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className   = 'success-toast';
    t.textContent = msg;
    if (type === 'error')   t.style.background = 'var(--negative)';
    if (type === 'warning') { t.style.background = 'var(--neutral)'; t.style.color = '#000'; }
    document.body.appendChild(t);
    setTimeout(() => t?.remove(), 2400);
  }

  // ─── HTML Escape ─────────────────────────────────────────
  function escHtml(str) {
    return (str || '')
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#039;');
  }

  // ─── Boot ────────────────────────────────────────────────
  init();

})();
