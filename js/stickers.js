// Hero stickers: drift in straight lines across the hero and bump into each other.
// Each sticker is a spinning disc, or a capsule if it's long: bumps are elastic, and friction
// at the contact point turns glancing hits into rotation (and rotation back into a sideways kick).
// Any sticker can be grabbed: drop it gently to park it, or fling it to scatter the rest.
(function () {
  var hero = document.querySelector('.hero-section');
  var wrap = document.querySelector('.stickers-wrap');
  var nav = document.querySelector('.navbar');
  if (!hero || !wrap) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var imgs = Array.prototype.slice.call(wrap.querySelectorAll('img'));
  var stickers = [];
  var bounds = null;
  var speed = 30;
  var running = false;
  var visible = true;
  var dirty = true;
  var last = 0;

  var held = null;           // the sticker being dragged
  var pointer = { x: 0, y: 0 };
  var zTop = 1;
  var pending = null;        // a finger resting on a sticker, not yet picked up

  var INERTIA = 0.5;      // moment of inertia as a fraction of m·r² (0.5 = solid disc)
  var FRICTION = 0.6;     // how much grip stickers have on each other when they bump
  var SPIN_GAIN = 3;      // exaggerates the spin from a bump so it reads at this slow pace
  var SPIN_DRAG = 0.15;   // per second; a gentle spin slowly dies down between bumps
  var SPIN_DRAG_FAST = 0.6; // extra drag per rad/s of spin, so a wild spin settles quickly
  var MAX_SPIN = 1.8;     // rad/s (~100°/s); spins approach this softly instead of clipping
  var SPIN_EASE = 8;      // per second; a bump's spin builds up over ~1/8 s instead of all at once
  var MAX_SPEED = 3000;   // px/s, for flung stickers
  var PARK_SPEED = 60;    // px/s; dropped slower than this, a sticker stays where it's put
  var LONG_PRESS = 300;   // ms a finger must rest on a sticker before it's picked up
  var PRESS_SLOP = 10;    // px a finger may wander during that press; more is a scroll
  var LIFT = 1.06;        // how much a held sticker grows, so it reads as picked up

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(v, min, max) {
    return max < min ? (min + max) / 2 : Math.min(max, Math.max(min, v));
  }

  // Half-size of the sticker's rotated outline (an ellipse filling its box),
  // so a turned oval still fits snugly against the hero edges.
  function extents(s) {
    var t = (s.base * Math.PI / 180) + s.angle;
    var c = Math.cos(t), sn = Math.sin(t);
    return {
      x: Math.sqrt(s.w * s.w * c * c + s.h * s.h * sn * sn) / 2,
      y: Math.sqrt(s.w * s.w * sn * sn + s.h * s.h * c * c) / 2
    };
  }

  // Everything is in the stickers-wrap coordinate space (the imgs' offsetParent),
  // so transforms never feed back into the measurements.
  function measure() {
    var w = wrap.getBoundingClientRect();
    var h = hero.getBoundingClientRect();
    // The whole hero, minus the strip the fixed nav covers.
    var next = {
      left: h.left - w.left,
      top: h.top - w.top + (nav ? nav.offsetHeight : 0),
      right: h.right - w.left,
      bottom: h.bottom - w.top
    };
    var prev = bounds;
    speed = Math.max(16, Math.min(next.right - next.left, next.bottom - next.top) * 0.06);

    stickers.forEach(function (s) {
      var el = s.el;
      s.ox = el.offsetLeft + el.offsetWidth / 2;
      s.oy = el.offsetTop + el.offsetHeight / 2;
      s.w = el.offsetWidth;
      s.h = el.offsetHeight;
      // Weight and inertia as a disc of the sticker's average size...
      var size = (s.w + s.h) / 4 * 0.9;
      s.m = size * size;
      s.i = INERTIA * s.m * size * size;
      // ...but long stickers (the frog, the alert card, the rock hand) collide as a capsule
      // along their long side, so they bump at their real ends. Round ones stay discs.
      var longSide = Math.max(s.w, s.h), shortSide = Math.min(s.w, s.h);
      if (longSide > shortSide * 1.3) {
        s.r = shortSide / 2 * 0.9;
        s.len = longSide / 2 * 0.9 - s.r;
        s.axis = s.w >= s.h ? 0 : Math.PI / 2;
      } else {
        s.r = size;
        s.len = 0;
        s.axis = 0;
      }
      if (prev) {
        // Keep each sticker at the same relative spot when the hero resizes.
        s.x = next.left + (s.x - prev.left) / ((prev.right - prev.left) || 1) * (next.right - next.left);
        s.y = next.top + (s.y - prev.top) / ((prev.bottom - prev.top) || 1) * (next.bottom - next.top);
      } else {
        s.x = s.ox;
        s.y = s.oy;
      }
    });

    bounds = next;
    dirty = false;
  }

  function step(dt, elapsed) {
    var b = bounds;
    var target = null;

    // The held sticker follows the pointer; its velocity is measured from that
    // motion, so swinging it into others hits them as hard as it's moving.
    if (held) {
      var e = extents(held);
      target = {
        x: clamp(pointer.x - held.grabX, b.left + e.x, b.right - e.x),
        y: clamp(pointer.y - held.grabY, b.top + e.y, b.bottom - e.y)
      };
      var k = Math.min(1, elapsed * 20);
      held.vx += ((target.x - held.x) / elapsed - held.vx) * k;
      held.vy += ((target.y - held.y) / elapsed - held.vy) * k;
    }

    // Split fast frames into substeps, so a flung sticker can't pass through another.
    var fastest = 0, smallest = Infinity;
    stickers.forEach(function (s) {
      fastest = Math.max(fastest, Math.sqrt(s.vx * s.vx + s.vy * s.vy));
      smallest = Math.min(smallest, s.r);
    });
    if (target) {
      fastest = Math.max(fastest, Math.sqrt(Math.pow(target.x - held.x, 2) + Math.pow(target.y - held.y, 2)) / dt);
    }
    var n = clamp(Math.ceil(fastest * dt / (smallest * 0.25)), 1, 12);
    var h = dt / n;

    for (var sub = 0; sub < n; sub++) {
      if (held) {
        held.x += (target.x - held.x) / (n - sub);
        held.y += (target.y - held.y) / (n - sub);
      }
      stickers.forEach(function (s) {
        if (!s.held) move(s, h);
      });
      for (var i = 0; i < stickers.length; i++) {
        for (var j = i + 1; j < stickers.length; j++) {
          collide(stickers[i], stickers[j], h);
        }
      }
    }
  }

  function move(s, dt) {
    var b = bounds;

    if (!s.parked) {
      // Ease back to cruising speed (a flung sticker slows down, a nudged one picks up);
      // direction is left alone, so between bumps every sticker moves in a straight line.
      var v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      if (v < 1) {
        var dir = rand(0, Math.PI * 2);
        s.vx = Math.cos(dir);
        s.vy = Math.sin(dir);
        v = 1;
      }
      var k = 1 + (speed * s.pace / v - 1) * Math.min(1, dt * 0.8);
      k = Math.min(k, MAX_SPEED / v);
      s.vx *= k;
      s.vy *= k;
    }

    s.x += s.vx * dt;
    s.y += s.vy * dt;

    var take = s.kick * Math.min(1, dt * SPIN_EASE);
    s.kick -= take;
    s.spin = MAX_SPIN * Math.tanh((s.spin + take) / MAX_SPIN);
    s.spin *= Math.max(0, 1 - (SPIN_DRAG + SPIN_DRAG_FAST * Math.abs(s.spin)) * dt);
    s.angle += s.spin * dt;

    var e = extents(s);
    var minX = b.left + e.x, maxX = b.right - e.x;
    var minY = b.top + e.y, maxY = b.bottom - e.y;
    if (s.x < minX) { s.x = clamp(minX, minX, maxX); s.vx = Math.abs(s.vx); }
    if (s.x > maxX) { s.x = clamp(maxX, minX, maxX); s.vx = -Math.abs(s.vx); }
    if (s.y < minY) { s.y = clamp(minY, minY, maxY); s.vy = Math.abs(s.vy); }
    if (s.y > maxY) { s.y = clamp(maxY, minY, maxY); s.vy = -Math.abs(s.vy); }
  }

  // A sticker's outline in the physics: a capsule, i.e. a segment through its centre
  // along its long side, padded by its radius. Round stickers have a zero-length segment.
  function segment(s) {
    var t = s.base * Math.PI / 180 + s.angle + s.axis;
    var ux = Math.cos(t) * s.len, uy = Math.sin(t) * s.len;
    return [s.x - ux, s.y - uy, s.x + ux, s.y + uy];
  }

  // Closest points between two segments [x1, y1, x2, y2].
  function closest(p, q) {
    var d1x = p[2] - p[0], d1y = p[3] - p[1];
    var d2x = q[2] - q[0], d2y = q[3] - q[1];
    var rx = p[0] - q[0], ry = p[1] - q[1];
    var a = d1x * d1x + d1y * d1y, e = d2x * d2x + d2y * d2y;
    var f = d2x * rx + d2y * ry;
    var s, t;
    if (a < 1e-9 && e < 1e-9) {
      s = t = 0;
    } else if (a < 1e-9) {
      s = 0;
      t = clamp(f / e, 0, 1);
    } else {
      var c = d1x * rx + d1y * ry;
      if (e < 1e-9) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else {
        var b = d1x * d2x + d1y * d2y, denom = a * e - b * b;
        s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
        else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
      }
    }
    return { ax: p[0] + d1x * s, ay: p[1] + d1y * s, bx: q[0] + d2x * t, by: q[1] + d2y * t };
  }

  function collide(a, b, dt) {
    var cp = closest(segment(a), segment(b));
    var dx = cp.bx - cp.ax;
    var dy = cp.by - cp.ay;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var min = a.r + b.r;
    if (dist >= min) return;

    // A held sticker is immovable: it has no inverse mass or inertia.
    var ima = a.held ? 0 : 1 / a.m, imb = b.held ? 0 : 1 / b.m;
    var iia = a.held ? 0 : 1 / a.i, iib = b.held ? 0 : 1 / b.i;
    if (ima + imb === 0) return;

    var nx, ny; // normal, from a to b
    if (dist > 1e-6) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      // The cores cross (two long stickers pushed through each other): use the centres.
      var cx = b.x - a.x, cy = b.y - a.y, cd = Math.sqrt(cx * cx + cy * cy);
      if (cd === 0) return;
      nx = cx / cd;
      ny = cy / cd;
    }
    var tx = -ny, ty = nx; // tangent

    // The contact point, between the two surfaces, and where it sits relative to each centre.
    var overlap = min - dist;
    var px = cp.ax + nx * (a.r - overlap / 2);
    var py = cp.ay + ny * (a.r - overlap / 2);
    var rax = px - a.x, ray = py - a.y;
    var rbx = px - b.x, rby = py - b.y;

    // How fast the two surfaces move against each other there, spin included.
    var rvx = (b.vx - b.spin * rby) - (a.vx - a.spin * ray);
    var rvy = (b.vy + b.spin * rbx) - (a.vy + a.spin * rax);
    var vn = rvx * nx + rvy * ny;

    // A held sticker shoves others out of its way at once. Otherwise separate gradually,
    // so stickers that start out overlapping drift apart instead of jumping.
    var push = (a.held || b.held) ? overlap : Math.min(overlap, (80 + Math.abs(vn)) * dt);
    a.x -= nx * push * ima / (ima + imb);
    a.y -= ny * push * ima / (ima + imb);
    b.x += nx * push * imb / (ima + imb);
    b.y += ny * push * imb / (ima + imb);

    if (vn >= 0) return; // already moving apart

    // Head-on part: an elastic bounce. A hit off a long sticker's centre also tips it round.
    // Anything that gets hit starts floating again.
    var ran = rax * ny - ray * nx, rbn = rbx * ny - rby * nx;
    var jn = -2 * vn / (ima + imb + ran * ran * iia + rbn * rbn * iib);
    a.vx -= jn * nx * ima;
    a.vy -= jn * ny * ima;
    b.vx += jn * nx * imb;
    b.vy += jn * ny * imb;
    a.kick -= jn * ran * iia;
    b.kick += jn * rbn * iib;
    if (ima) a.parked = false;
    if (imb) b.parked = false;

    // Glancing part: the two surfaces slide past each other at the contact point.
    // Friction opposes that slide, which spins both stickers (in opposite directions)
    // and lets an already-spinning sticker kick the other one sideways.
    var rat = rax * ty - ray * tx, rbt = rbx * ty - rby * tx;
    var slide = rvx * tx + rvy * ty;
    var jt = -slide / (ima + imb + rat * rat * iia + rbt * rbt * iib);
    jt = clamp(jt, -FRICTION * jn, FRICTION * jn);
    a.vx -= jt * tx * ima;
    a.vy -= jt * ty * ima;
    b.vx += jt * tx * imb;
    b.vy += jt * ty * imb;
    a.kick -= SPIN_GAIN * jt * rat * iia;
    b.kick += SPIN_GAIN * jt * rbt * iib;
  }


  function render() {
    stickers.forEach(function (s) {
      s.el.style.transform =
        'translate(' + (s.x - s.ox).toFixed(2) + 'px, ' + (s.y - s.oy).toFixed(2) + 'px) ' +
        'rotate(' + (s.base + s.angle * 180 / Math.PI).toFixed(2) + 'deg) ' +
        'scale(' + s.lift.toFixed(3) + ')';
    });
  }

  function frame(t) {
    if (!running) return;
    var elapsed = Math.min((t - last) / 1000, 0.25);
    var dt = Math.min(elapsed, 1 / 30);
    last = t;
    if (dirty) measure();
    if (dt > 0) step(dt, elapsed);
    stickers.forEach(function (s) {
      s.lift += ((s.held ? LIFT : 1) - s.lift) * Math.min(1, elapsed * 15);
    });
    render();
    requestAnimationFrame(frame);
  }

  function start() {
    if (running || !visible) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function toWrap(e) {
    var w = wrap.getBoundingClientRect();
    return { x: e.clientX - w.left, y: e.clientY - w.top };
  }

  // Remember the last moments of pointer movement to work out how hard a sticker was thrown.
  function track(s, p) {
    var now = performance.now();
    s.trail.push({ t: now, x: p.x, y: p.y });
    while (s.trail.length > 2 && now - s.trail[0].t > 150) s.trail.shift();
  }

  function throwVelocity(s) {
    var now = performance.now();
    var lastP = s.trail[s.trail.length - 1];
    if (!lastP || now - lastP.t > 80) return { x: 0, y: 0 }; // the pointer had stopped
    var first = lastP;
    for (var i = s.trail.length - 1; i >= 0 && lastP.t - s.trail[i].t <= 100; i--) first = s.trail[i];
    var dt = (lastP.t - first.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (lastP.x - first.x) / dt, y: (lastP.y - first.y) / dt };
  }

  function grab(s, e, touch) {
    if (held || !bounds) return;
    pointer = toWrap(e);
    s.touch = !!touch;
    held = s;
    s.held = true;
    s.parked = false;
    s.spin = 0;
    s.kick = 0;
    s.grabX = pointer.x - s.x;
    s.grabY = pointer.y - s.y;
    s.pointerId = e.pointerId;
    s.trail = [];
    track(s, pointer);
    try { s.el.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
    s.el.style.zIndex = ++zTop; // the last sticker touched stays on top
    s.el.classList.add('is-held');
    start();
  }

  // Mouse and pen grab at once. A finger has to rest on the sticker for a moment first,
  // so a quick touch-and-swipe still scrolls the page.
  function press(s, e) {
    if (e.pointerType !== 'touch') {
      if (e.button > 0) return;
      e.preventDefault();
      grab(s, e);
      return;
    }
    if (held || pending) return;
    pending = { s: s, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, clientX: e.clientX, clientY: e.clientY };
    pending.timer = setTimeout(function () {
      var p = pending;
      pending = null;
      grab(p.s, p, true);
      if (navigator.vibrate) navigator.vibrate(10);
    }, LONG_PRESS);
  }

  function cancelPress() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  }

  function release(s, e) {
    if (pending && e.pointerId === pending.pointerId) cancelPress();
    if (held !== s || e.pointerId !== s.pointerId) return;
    held = null;
    s.held = false;
    s.el.classList.remove('is-held');
    // Let go mid-swing and it flies; set down gently and it stays put until something hits it.
    var thrown = throwVelocity(s);
    s.vx = thrown.x;
    s.vy = thrown.y;
    var v = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
    if (v < PARK_SPEED) {
      s.vx = 0;
      s.vy = 0;
      s.parked = true;
    } else if (v > MAX_SPEED) {
      s.vx *= MAX_SPEED / v;
      s.vy *= MAX_SPEED / v;
    }
  }

  function init() {
    stickers = imgs.map(function (el) {
      el.style.animation = 'none';
      el.style.willChange = 'transform';
      el.draggable = false;
      return {
        el: el,
        base: parseFloat(getComputedStyle(el).getPropertyValue('--rotation')) || 0,
        angle: 0,
        spin: 0,
        kick: 0,
        pace: rand(0.7, 1.3),
        lift: 1,
        held: false,
        parked: false
      };
    });
    measure();
    stickers.forEach(function (s) {
      var dir = rand(0, Math.PI * 2);
      s.vx = Math.cos(dir) * speed * s.pace;
      s.vy = Math.sin(dir) * speed * s.pace;

      s.el.addEventListener('pointerdown', function (e) { press(s, e); });
      s.el.addEventListener('pointermove', function (e) {
        if (pending && e.pointerId === pending.pointerId) {
          pending.clientX = e.clientX;
          pending.clientY = e.clientY;
          if (Math.abs(e.clientX - pending.x0) > PRESS_SLOP || Math.abs(e.clientY - pending.y0) > PRESS_SLOP) cancelPress();
        } else if (held === s && e.pointerId === s.pointerId) {
          pointer = toWrap(e);
          track(s, pointer);
        }
      });
      s.el.addEventListener('pointerup', function (e) { release(s, e); });
      s.el.addEventListener('pointercancel', function (e) { release(s, e); });
      s.el.addEventListener('lostpointercapture', function (e) { release(s, e); });
      s.el.addEventListener('dragstart', function (e) { e.preventDefault(); });
      // No "save image" menu from the long press that picks a sticker up.
      s.el.addEventListener('contextmenu', function (e) {
        if (held === s || (pending && pending.s === s)) e.preventDefault();
      });
    });

    // Make sure a lifted finger or mouse button always lets go, wherever it ends up.
    ['pointerup', 'pointercancel'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (pending && e.pointerId === pending.pointerId) cancelPress();
        if (held) release(held, e);
      });
    });

    // Once a finger has picked a sticker up, its moves drag the sticker, not the page.
    window.addEventListener('touchmove', function (e) {
      if (held && held.touch) e.preventDefault();
    }, { passive: false });
    wrap.classList.add('is-interactive');

    window.addEventListener('resize', function () { dirty = true; });
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () { dirty = true; });
      ro.observe(hero);
      ro.observe(wrap);
    }

    // Pause while the hero is scrolled out of view.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) start(); else running = false;
      }).observe(hero);
    }
    start();
  }

  // Stickers are lazy-loaded; their sizes are only known once they've loaded.
  Promise.all(imgs.map(function (img) {
    if (img.complete && img.naturalWidth) return null;
    img.loading = 'eager';
    return new Promise(function (resolve) {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  })).then(init);
})();
