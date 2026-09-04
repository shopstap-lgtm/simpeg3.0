/**
 * SIMPEG Korwil Cibitung 2.0 - Client Utilities
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Configure PDF.js worker if available
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.js';
  }

  console.log('SIMPEG Korwil Cibitung 2.0 Frontend Loaded.');
});

/**
 * Universal Mobile & Desktop PDF Canvas Renderer via PDF.js
 * Renders high-DPI canvas pages smoothly inside target container
 */
window.renderPdfToCanvas = async function(url, containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = '';

  if (!url || url === 'about:blank' || url.trim() === '') {
    containerEl.innerHTML = `
      <div class="flex flex-col items-center justify-center p-8 text-center text-slate-400 my-auto">
        <svg class="w-12 h-12 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <span class="text-xs font-semibold text-slate-600">Berkas Belum Diunggah</span>
        <span class="text-[11px] text-slate-400 mt-0.5">Pegawai belum melampirkan berkas PDF ini.</span>
      </div>
    `;
    return;
  }

  // Loading state with animated spinner
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'flex flex-col items-center justify-center p-8 sm:p-12 text-slate-500 my-auto w-full';
  loadingDiv.innerHTML = `
    <div class="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
    <span class="text-xs font-bold text-slate-700">Memuat Dokumen PDF...</span>
    <span class="text-[11px] text-slate-400 mt-1">Mengonversi halaman untuk tampilan layar</span>
  `;
  containerEl.appendChild(loadingDiv);

  try {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js belum termuat di halaman');
    }
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.js';

    // Strip anchor tags (#toolbar=...) if present
    const cleanUrl = url.split('#')[0];
    const loadingTask = window.pdfjsLib.getDocument({
      url: cleanUrl,
      enableXfa: true,
    });

    const pdf = await loadingTask.promise;
    containerEl.innerHTML = '';
    const numPages = pdf.numPages;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const containerWidth = containerEl.clientWidth || (window.innerWidth - 32);
      const unscaledViewport = page.getViewport({ scale: 1 });
      
      // Target width: fit container width nicely (with padding)
      const targetWidth = Math.max(containerWidth - 16, 280);
      const baseScale = Math.min(targetWidth / unscaledViewport.width, 2.0);
      const dpr = window.devicePixelRatio || 1;
      
      const viewport = page.getViewport({ scale: baseScale * dpr });

      const pageCard = document.createElement('div');
      pageCard.className = 'w-full bg-white shadow-md rounded-xl overflow-hidden mb-4 border border-slate-200/90 mx-auto';
      pageCard.style.maxWidth = `${Math.floor(unscaledViewport.width * baseScale)}px`;

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.display = 'block';

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      // Footer badge showing page number and external open link
      const pageFooter = document.createElement('div');
      pageFooter.className = 'py-1.5 px-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 font-semibold';
      pageFooter.innerHTML = `
        <span>Halaman ${pageNum} dari ${numPages}</span>
        <a href="${cleanUrl}" target="_blank" class="text-indigo-600 hover:text-indigo-800 font-bold inline-flex items-center gap-1">
          <span>Buka Penuh ↗</span>
        </a>
      `;

      pageCard.appendChild(canvas);
      pageCard.appendChild(pageFooter);
      containerEl.appendChild(pageCard);
    }
  } catch (err) {
    console.error('Gagal render PDF via PDF.js:', err);
    const cleanUrl = url.split('#')[0];
    containerEl.innerHTML = `
      <div class="p-6 text-center space-y-3 my-auto w-full">
        <div class="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto shadow-2xs">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        </div>
        <div>
          <h4 class="font-bold text-sm text-slate-800">Pratinjau PDF Mobile</h4>
          <p class="text-xs text-slate-500 max-w-xs mx-auto mt-1">Browser Anda membatasi render inline. Buka berkas PDF langsung di aplikasi HP Anda:</p>
        </div>
        <div class="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2">
          <a href="${cleanUrl}" target="_blank" class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-xs shadow-md shadow-indigo-200 inline-flex items-center justify-center gap-1.5">
            <span>Buka di Tab Baru / App HP</span>
          </a>
          <a href="${cleanUrl}" download class="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 font-bold text-xs inline-flex items-center justify-center gap-1.5 border border-slate-200">
            <span>Unduh Berkas</span>
          </a>
        </div>
      </div>
    `;
  }
};
