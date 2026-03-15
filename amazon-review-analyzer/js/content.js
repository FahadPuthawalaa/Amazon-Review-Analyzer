// ============================================================
// Amazon Review Analyzer Pro — content.js
// Extracts product & review data from Amazon product pages
// ============================================================

(function () {
  'use strict';

  // ─── Message Listener ────────────────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getProductData') {
      const data = extractProductData();
      sendResponse(data);
    }
    return true; // keep channel open
  });

  // ─── Extract Product Data ────────────────────────────────
  function extractProductData() {
    const data = {
      title: '',
      rating: '',
      reviewCount: '',
      category: '',
      asin: '',
      price: '',
      reviews: []
    };

    // --- Title ---
    const titleEl = document.querySelector('#productTitle, #title');
    data.title = titleEl?.textContent?.trim()?.slice(0, 80) || '';

    // --- Rating ---
    const ratingEl = document.querySelector(
      '#acrPopover span.a-icon-alt, .reviewCountTextLinkedHistogram .a-icon-alt, #averageCustomerReviews .a-icon-alt'
    );
    const ratingText = ratingEl?.textContent?.trim() || '';
    const ratingMatch = ratingText.match(/^([\d.]+)/);
    data.rating = ratingMatch ? parseFloat(ratingMatch[1]).toFixed(1) : '';

    // --- Review Count ---
    const reviewCountEl = document.querySelector(
      '#acrCustomerReviewText, #reviews-medley-cmps-expand-head .a-size-base, [data-hook="total-review-count"]'
    );
    const rcText = reviewCountEl?.textContent?.trim() || '';
    const rcMatch = rcText.match(/([\d,]+)/);
    data.reviewCount = rcMatch ? rcMatch[1].replace(/,/g, '') : '';

    // --- ASIN from URL ---
    const asinMatch = location.href.match(/\/dp\/([A-Z0-9]{10})|\/gp\/product\/([A-Z0-9]{10})/);
    data.asin = asinMatch ? (asinMatch[1] || asinMatch[2]) : '';

    // --- Category Breadcrumb ---
    const catEl = document.querySelector('#wayfinding-breadcrumbs_container .a-list-item:last-child a, .nav-a.nav-b');
    data.category = catEl?.textContent?.trim()?.slice(0, 30) || '';

    // --- Price ---
    const priceEl = document.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice');
    data.price = priceEl?.textContent?.trim() || '';

    // --- Reviews on Page ---
    data.reviews = extractReviewsFromPage();

    return data;
  }

  // ─── Extract Reviews From Page ───────────────────────────
  function extractReviewsFromPage() {
    const reviews = [];

    // Try multiple selectors for different Amazon layouts
    const reviewEls = document.querySelectorAll(
      '[data-hook="review"], .review, .a-section.review'
    );

    reviewEls.forEach(el => {
      try {
        const ratingEl = el.querySelector('[data-hook="review-star-rating"] .a-icon-alt, .review-rating .a-icon-alt');
        const titleEl = el.querySelector('[data-hook="review-title"] span:not(.a-icon-alt), .review-title span');
        const bodyEl = el.querySelector('[data-hook="review-body"] span, .review-text span, [data-hook="review-body"]');
        const dateEl = el.querySelector('[data-hook="review-date"], .review-date');
        const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"]');

        const ratingText = ratingEl?.textContent?.trim() || '';
        const ratingMatch = ratingText.match(/^([\d.]+)/);
        const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
        const title = titleEl?.textContent?.trim() || '';
        const body = bodyEl?.textContent?.trim() || '';
        const date = dateEl?.textContent?.trim() || '';
        const helpful = helpfulEl?.textContent?.trim() || '';

        if (body && body.length > 10) {
          reviews.push({
            rating: rating,
            title: title.slice(0, 100),
            body: body.slice(0, 500),
            date: date,
            helpful: helpful
          });
        }
      } catch (e) {}
    });

    // If no reviews found on current page (e.g., main product page, not review page)
    // Try to get snippet reviews from the product page
    if (reviews.length === 0) {
      const snippetEls = document.querySelectorAll('.cr-widget-Halo .a-section, #customer-reviews-content .a-section');
      snippetEls.forEach(el => {
        try {
          const body = el.querySelector('.review-text, .a-truncate-full')?.textContent?.trim() || '';
          const ratingMatch = el.querySelector('.a-icon-alt')?.textContent?.match(/^([\d.]+)/);
          const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
          if (body && body.length > 20) {
            reviews.push({ rating, title: '', body: body.slice(0, 400), date: '', helpful: '' });
          }
        } catch (e) {}
      });
    }

    return reviews.slice(0, 30); // Max 30 reviews to keep prompt manageable
  }

  // ─── Inject Floating Analyze Button ──────────────────────
  function injectFloatingBtn() {
    if (document.getElementById('rpa-float-btn')) return;

    const isProductPage = /\/dp\/|\/gp\/product\//i.test(location.href);
    if (!isProductPage) return;

    const btn = document.createElement('div');
    btn.id = 'rpa-float-btn';
    btn.innerHTML = `
      <div class="rpa-float-inner">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <span>Analyze Reviews</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
    });
    document.body.appendChild(btn);
  }

  // Run on product pages
  if (/\/dp\/|\/gp\/product\//i.test(location.href)) {
    injectFloatingBtn();
  }

})();
