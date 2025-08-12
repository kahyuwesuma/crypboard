// components/preload/modal-preloader.js

class ModalPreloader {
  constructor() {
    this.activeModals = new Map();
    this.defaultConfig = {
      showProgress: true,
      showMessage: true,
      showSpinner: true,
      timeout: 15000, // 15 detik timeout default
      progressSteps: [
        { step: 0, message: 'Initializing...' },
        { step: 25, message: 'Connecting to exchange...' },
        { step: 50, message: 'Fetching orderbook data...' },
        { step: 75, message: 'Processing data...' },
        { step: 100, message: 'Complete!' }
      ]
    };
  }

  // Membuat HTML untuk loading component
  createLoadingHTML(config = {}) {
    const finalConfig = { ...this.defaultConfig, ...config };
    
    return `
      <div class="modal-preloader" id="modalPreloader">
        <div class="preloader-container">
          ${finalConfig.showSpinner ? `
            <div class="spinner-container">
              <div class="loading-spinner"></div>
            </div>
          ` : ''}
          
          ${finalConfig.showMessage ? `
            <div class="loading-message" id="loadingMessage">
              ${finalConfig.progressSteps[0].message}
            </div>
          ` : ''}
          
          ${finalConfig.showProgress ? `
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
              </div>
              <div class="progress-text" id="progressText">0%</div>
            </div>
          ` : ''}
          
          <div class="loading-details" id="loadingDetails">
            Fetching data for <span class="symbol-highlight" id="loadingSymbol">-</span> from <span class="exchange-highlight" id="loadingExchange">-</span>
          </div>
        </div>
      </div>
    `;
  }

  // Inisialisasi preloader untuk modal tertentu
  initPreloader(modalId, config = {}) {
    const modal = document.getElementById(modalId);
    if (!modal) {
      console.error(`Modal with ID ${modalId} not found`);
      return false;
    }

    const finalConfig = { ...this.defaultConfig, ...config };
    this.activeModals.set(modalId, {
      config: finalConfig,
      startTime: Date.now(),
      currentStep: 0,
      timeoutId: null,
      progressInterval: null
    });

    // Inject CSS jika belum ada
    this.injectCSS();

    return true;
  }

  // Menampilkan loading di modal
  showLoading(modalId, symbol = '', exchange = '', config = {}) {
    if (!this.initPreloader(modalId, config)) return;

    const modal = document.getElementById(modalId);
    const modalData = this.activeModals.get(modalId);
    const finalConfig = modalData.config;

    // Update konten modal dengan loading
    const modalContent = modal.querySelector('#modalContent') || modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.innerHTML = this.createLoadingHTML(finalConfig);
      
      // Update detail loading
      const symbolEl = document.getElementById('loadingSymbol');
      const exchangeEl = document.getElementById('loadingExchange');
      
      if (symbolEl) symbolEl.textContent = symbol;
      if (exchangeEl) exchangeEl.textContent = exchange.toUpperCase();
    }

    // Start progress animation
    this.startProgressAnimation(modalId);

    // Set timeout untuk error handling
    modalData.timeoutId = setTimeout(() => {
      this.showError(modalId, 'Request timeout. Please try again.');
    }, finalConfig.timeout);

    return true;
  }

  // Animasi progress bar
  startProgressAnimation(modalId) {
    const modalData = this.activeModals.get(modalId);
    if (!modalData) return;

    const config = modalData.config;
    let currentProgress = 0;
    let currentStepIndex = 0;

    modalData.progressInterval = setInterval(() => {
      currentProgress += Math.random() * 15 + 5; // Progress 5-20% per interval
      
      if (currentProgress >= 100) {
        currentProgress = 100;
        clearInterval(modalData.progressInterval);
      }

      // Update progress bar
      const progressFill = document.getElementById('progressFill');
      const progressText = document.getElementById('progressText');
      
      if (progressFill) progressFill.style.width = `${currentProgress}%`;
      if (progressText) progressText.textContent = `${Math.round(currentProgress)}%`;

      // Update message berdasarkan progress
      const targetStep = config.progressSteps.find(step => currentProgress >= step.step && currentProgress < (config.progressSteps[config.progressSteps.findIndex(s => s === step) + 1]?.step || 101));
      
      if (targetStep && currentStepIndex !== config.progressSteps.indexOf(targetStep)) {
        currentStepIndex = config.progressSteps.indexOf(targetStep);
        const messageEl = document.getElementById('loadingMessage');
        if (messageEl) {
          messageEl.style.opacity = '0';
          setTimeout(() => {
            messageEl.textContent = targetStep.message;
            messageEl.style.opacity = '1';
          }, 200);
        }
      }
    }, 300 + Math.random() * 200); // Interval 300-500ms untuk variasi
  }

  // Menyembunyikan loading dan menampilkan konten
  hideLoading(modalId, contentHTML = '') {
    const modalData = this.activeModals.get(modalId);
    if (!modalData) return;

    // Clear timers
    if (modalData.timeoutId) {
      clearTimeout(modalData.timeoutId);
    }
    if (modalData.progressInterval) {
      clearInterval(modalData.progressInterval);
    }

    // Smooth transition ke konten
    const modal = document.getElementById(modalId);
    const preloader = modal.querySelector('#modalPreloader');
    
    if (preloader) {
      preloader.style.opacity = '0';
      preloader.style.transform = 'scale(0.9)';
      
      setTimeout(() => {
        const modalContent = modal.querySelector('#modalContent') || modal.querySelector('.modal-content');
        if (modalContent && contentHTML) {
          modalContent.innerHTML = contentHTML;
          modalContent.style.opacity = '0';
          modalContent.style.transform = 'scale(1.1)';
          
          requestAnimationFrame(() => {
            modalContent.style.transition = 'all 0.3s ease';
            modalContent.style.opacity = '1';
            modalContent.style.transform = 'scale(1)';
          });
        }
      }, 300);
    }

    // Cleanup
    this.activeModals.delete(modalId);
  }

  // Menampilkan error state
  showError(modalId, errorMessage = 'An error occurred while loading data.') {
    const modal = document.getElementById(modalId);
    const modalContent = modal.querySelector('#modalContent') || modal.querySelector('.modal-content');
    
    if (modalContent) {
      modalContent.innerHTML = `
        <div class="modal-error">
          <div class="error-icon">⚠️</div>
          <div class="error-message">${errorMessage}</div>
          <button class="retry-button" onclick="modalPreloader.retryLoading('${modalId}')">
            Retry
          </button>
        </div>
      `;
    }

    // Cleanup modal data
    const modalData = this.activeModals.get(modalId);
    if (modalData) {
      if (modalData.timeoutId) clearTimeout(modalData.timeoutId);
      if (modalData.progressInterval) clearInterval(modalData.progressInterval);
      this.activeModals.delete(modalId);
    }
  }

  // Retry function (bisa di-override sesuai kebutuhan)
  retryLoading(modalId) {
    const modal = document.getElementById(modalId);
    const modalTitle = modal.querySelector('#modalTitle')?.innerText || '';
    const symbolMatch = modalTitle.match(/Detail\s+(\S+)\s*-\s*(\S+)/);
    
    if (symbolMatch) {
      const symbol = symbolMatch[1];
      const exchange = symbolMatch[2];
      
      // Trigger ulang request orderbook
      window.electron.send('request-orderbook', { symbol, exchange });
      this.showLoading(modalId, symbol, exchange);
    }
  }

  // Update progress secara manual (untuk kontrol yang lebih detail)
  updateProgress(modalId, progress, message = '') {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const messageEl = document.getElementById('loadingMessage');
    
    if (progressFill) progressFill.style.width = `${progress}%`;
    if (progressText) progressText.textContent = `${Math.round(progress)}%`;
    if (message && messageEl) {
      messageEl.style.opacity = '0';
      setTimeout(() => {
        messageEl.textContent = message;
        messageEl.style.opacity = '1';
      }, 200);
    }
  }

  // Inject CSS styles
  injectCSS() {
    if (document.getElementById('modal-preloader-styles')) return;

    const style = document.createElement('style');
    style.id = 'modal-preloader-styles';
    style.textContent = `
      .modal-preloader {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 300px;
        transition: all 0.3s ease;
      }

      .preloader-container {
        text-align: center;
        max-width: 400px;
        padding: 40px 20px;
      }

      .spinner-container {
        margin-bottom: 30px;
      }

      .loading-spinner {
        width: 50px;
        height: 50px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #007bff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto;
      }

      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .loading-message {
        font-size: 16px;
        color: #666;
        margin-bottom: 20px;
        transition: opacity 0.3s ease;
        font-weight: 500;
      }

      .progress-container {
        margin-bottom: 20px;
      }

      .progress-bar {
        width: 100%;
        height: 8px;
        background-color: #e9ecef;
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 10px;
      }

      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #007bff, #0056b3);
        border-radius: 4px;
        transition: width 0.3s ease;
        width: 0%;
      }

      .progress-text {
        font-size: 14px;
        color: #666;
        font-weight: 600;
      }

      .loading-details {
        font-size: 14px;
        color: #8a8a8a;
        margin-top: 15px;
      }

      .symbol-highlight {
        color: #007bff;
        font-weight: 600;
      }

      .exchange-highlight {
        color: #28a745;
        font-weight: 600;
      }

      .modal-error {
        text-align: center;
        padding: 40px 20px;
      }

      .error-icon {
        font-size: 48px;
        margin-bottom: 20px;
      }

      .error-message {
        font-size: 16px;
        color: #dc3545;
        margin-bottom: 20px;
        font-weight: 500;
      }

      .retry-button {
        background-color: #007bff;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.3s ease;
      }

      .retry-button:hover {
        background-color: #0056b3;
      }

      .retry-button:active {
        transform: translateY(1px);
      }
    `;

    document.head.appendChild(style);
  }

  // Cleanup semua active modals (berguna saat aplikasi ditutup)
  cleanup() {
    this.activeModals.forEach((modalData, modalId) => {
      if (modalData.timeoutId) clearTimeout(modalData.timeoutId);
      if (modalData.progressInterval) clearInterval(modalData.progressInterval);
    });
    this.activeModals.clear();
  }
}

// Export sebagai singleton instance
const modalPreloader = new ModalPreloader();

// Jika di environment Node.js

module.exports = { modalPreloader }