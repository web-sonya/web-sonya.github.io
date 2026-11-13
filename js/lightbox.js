// Project pages: click or tap a screenshot to open it full size over a tinted, blurred page,
// with the card's caption underneath. Closes on the button, a click outside the image, or Esc.
(function () {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('.project-card .project-img'));
  if (!imgs.length) return;

  var box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-hidden', 'true');
  box.innerHTML =
    '<div class="lightbox-content">' +
      '<button type="button" class="lightbox-close" aria-label="Close">' +
        '<img class="is-desk" src="images/Close-lightbox.svg" width="40" height="40" alt="">' +
        '<img class="is-mob" src="images/Close-lightbox-mob.svg" width="24" height="24" alt="">' +
      '</button>' +
      '<div class="lightbox-box"><img class="lightbox-img" alt=""></div>' +
      '<div class="lightbox-caption"></div>' +
    '</div>';
  document.body.appendChild(box);

  var closeBtn = box.querySelector('.lightbox-close');
  var full = box.querySelector('.lightbox-img');
  var caption = box.querySelector('.lightbox-caption');
  var frame = box.querySelector('.lightbox-box');
  var opener = null;

  // Landscape screenshots (the wide overview shots) fill the box edge to edge, trimming the sides
  // on narrower boxes; portrait ones sit whole inside it on the lavender backing.
  function isWide(ratio) {
    return ratio > 1;
  }

  // The thumbnail may not have loaded yet, so check again against the full image.
  full.addEventListener('load', function () {
    if (full.naturalHeight) full.classList.toggle('is-cover', isWide(full.naturalWidth / full.naturalHeight));
  });

  function open(img) {
    var text = img.parentNode.querySelector('.project-caption');
    var w = frame.offsetWidth, h = frame.offsetHeight;
    var ratio = img.naturalHeight ? img.naturalWidth / img.naturalHeight : 0;
    var cover = isWide(ratio);
    opener = img;
    full.classList.toggle('is-cover', cover);
    // data-lightbox-fit="whole": never trim this shot; on mobile it shows full width instead.
    full.classList.toggle('is-whole', img.getAttribute('data-lightbox-fit') === 'whole');
    full.removeAttribute('srcset');
    full.src = img.getAttribute('src');
    if (img.srcset) {
      full.srcset = img.srcset;
      // Without a known shape, ask for the box width so the image is never soft.
      full.sizes = Math.ceil((!ratio ? w : cover ? Math.max(w, h * ratio) : Math.min(w, h * ratio)) || 500) + 'px';
    }
    full.alt = img.alt || (text ? text.textContent : '');
    caption.textContent = text ? text.textContent : '';
    box.scrollTop = 0;
    box.classList.add('is-open');
    box.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lightbox-locked');
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (!box.classList.contains('is-open')) return;
    box.classList.remove('is-open');
    box.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-locked');
    if (opener) opener.focus({ preventScroll: true });
    opener = null;
  }

  imgs.forEach(function (img) {
    img.setAttribute('tabindex', '0');
    img.setAttribute('role', 'button');
    img.addEventListener('click', function () { open(img); });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(img);
      }
    });
  });

  closeBtn.addEventListener('click', close);
  // Anywhere except the screenshot itself closes the box, including the empty overlay around it.
  box.addEventListener('click', function (e) {
    if (e.target !== full && !closeBtn.contains(e.target)) close();
  });
  document.addEventListener('keydown', function (e) {
    if (!box.classList.contains('is-open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      e.preventDefault(); // the close button is the only control inside the dialog
      closeBtn.focus();
    }
  });
})();
