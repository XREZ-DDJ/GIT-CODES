import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { CartUpdateEvent, ThemeEvents } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint } from '@theme/utilities';

export class QuickAddComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Document | null} */
  #cachedProductHtml = null;

  get cachedProductHtml() {
    return this.#cachedProductHtml;
  }

  get productPageUrl() {
    return /** @type {HTMLAnchorElement} */ (this.closest('product-card')?.querySelector('a[ref="productCardLink"]'))
      ?.href;
  }

  connectedCallback() {
    super.connectedCallback();

    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
  }

  /**
   * Handles quick add button click
   * @param {Event} event - The click event
   */
  handleClick = async (event) => {
    event.preventDefault();

    if (!this.#cachedProductHtml) {
      await this.fetchProductPage(this.productPageUrl);
    }

    if (this.#cachedProductHtml) {
      // Create a fresh copy of the cached HTML to avoid modifying the original
      const freshHtmlCopy = new DOMParser().parseFromString(
        this.#cachedProductHtml.documentElement.outerHTML,
        'text/html'
      );

      await this.updateQuickAddModal(freshHtmlCopy);
    }

    this.#openQuickAddModal();
  };

  /** @param {QuickAddDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    dialogComponent.closeDialog();
  };

  /**
   * Fetches the product page content
   * @param {string} productPageUrl - The URL of the product page to fetch
   * @returns {Promise<void>}
   * @throws {Error} If the fetch request fails or returns a non-200 response
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return;

    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();
      const html = new DOMParser().parseFromString(responseText, 'text/html');

      // Store the HTML for later use
      this.#cachedProductHtml = html;
    } catch (error) {
      if (error.name === 'AbortError') {
        return;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  /**
   * Re-renders the variant picker.
   * @param {Document} newHtml - The new HTML.
   */
  async updateQuickAddModal(newHtml) {
    const productGrid = newHtml.querySelector('[data-product-grid-content]');
    const modalContent = document.getElementById('quick-add-modal-content');

    if (!productGrid || !modalContent) return;

    // Get the pre-rendered variant selector from the component itself
    const unifiedSelectorTemplate = this.querySelector('variant-selector-unified');

    if (isMobileBreakpoint()) {
      const productPrice = productGrid.querySelector('product-price');
      const productDetails = productGrid.querySelector('.product-details');
      if (productDetails) productDetails.remove();

      // Remove any placeholder form elements from the fetched HTML
      const productFormComponent = productGrid.querySelector('product-form-component');
      if (productFormComponent) productFormComponent.remove();
      const variantPicker = productGrid.querySelector('variant-picker');
      if (variantPicker) variantPicker.remove();

      // Re-create the header as in the original code
      const productTitle = document.createElement('a');
      productTitle.textContent = this.dataset.productTitle || '';
      productTitle.href = this.productPageUrl;

      const productHeader = document.createElement('div');
      productHeader.classList.add('product-header');

      productHeader.appendChild(productTitle);
      if (productPrice) productHeader.appendChild(productPrice);
      productGrid.appendChild(productHeader);

      // Append the new unified selector if it exists
      if (unifiedSelectorTemplate) {
        productGrid.appendChild(unifiedSelectorTemplate.cloneNode(true));
      }
    } else {
      // Desktop
      const productDetails = productGrid.querySelector('.product-details');
      if (productDetails && unifiedSelectorTemplate) {
        // Find the container for the form elements, default to productDetails if not found
        const formContainer = productDetails.querySelector('.group-block-content') || productDetails;

        // Remove old/placeholder form elements from the fetched HTML
        const oldFormElements = formContainer.querySelectorAll('variant-picker, .buy-buttons-block, product-form-component');
        oldFormElements.forEach((el) => el.remove());

        // Append the new unified selector
        formContainer.appendChild(unifiedSelectorTemplate.cloneNode(true));
      }
    }

    morph(modalContent, productGrid);

    if (isMobileBreakpoint()) {
      const slides = modalContent.querySelectorAll('slideshow-slide');
      if (slides.length > 0) {
        // On mobile, ensure only one slide is visible initially.
        // The filterGalleryByColor function will handle changes.
        slides.forEach((slide) => slide.classList.remove('is-visible'));
        slides[0].classList.add('is-visible');
      }
    }
  }
}

if (!customElements.get('quick-add-component')) {
  customElements.define('quick-add-component', QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductTitleLink);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
  }

  /**
   * Closes the dialog
   * @param {CartUpdateEvent} event - The cart update event
   */
  handleCartUpdate = (event) => {
    if (event.detail.data.didError) return;
    this.closeDialog();
  };

  #updateProductTitleLink = (/** @type {CustomEvent} */ event) => {
    const anchorElement = /** @type {HTMLAnchorElement} */ (
      event.detail.data.html?.querySelector('.view-product-title a')
    );
    const viewMoreDetailsLink = /** @type {HTMLAnchorElement} */ (this.querySelector('.view-product-title a'));
    const mobileProductTitle = /** @type {HTMLAnchorElement} */ (this.querySelector('.product-header a'));

    if (!anchorElement) return;

    if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
    if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
  };
}

if (!customElements.get('quick-add-dialog')) {
  customElements.define('quick-add-dialog', QuickAddDialog);
}
