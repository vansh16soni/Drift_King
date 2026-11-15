// Drift King game engine

(() => {
  'use strict';

  // Storage keys and game constants
  const STORAGE_KEYS = {
    BEST_SCORE: 'driftking_best_score',
    THEME: 'driftking_theme',
    AUDIO_MUTED: 'driftking_audio_muted',
    TRACK: 'driftking_track_idx',
    CAR: 'driftking_car_type'
  };

  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 580;

  // Drift Physics constants
  const DRIFT_MIN_SPEED = 1.7;
  const DRIFT_ANGLE_THRESHOLD = 0.2618; // 15 degrees in radians
  const BANK_GRACE_TIME = 0.65; // Seconds after drift ends before banking points
  const MAX_REVERSE_RATIO = 0.35;

  // Audio manager: Web Audio synthesizer with sound element fallbacks
  class AudioManager {
    constructor() {
      this.muted = localStorage.getItem(STORAGE_KEYS.AUDIO_MUTED) === 'true';
      this.ctx = null;
      this.isUnlocked = false;

      // HTML Audio Elements
      this.elMove = document.getElementById('audioMove');
      this.elScreech = document.getElementById('audioScreech');
      this.elCrash = document.getElementById('audioCrash');
      this.elBg = document.getElementById('audioBackground');

      // Synthesizer nodes
      this.engineOsc = null;
      this.engineGain = null;
      this.engineFilter = null;

      this.screechSource = null;
      this.screechGain = null;
      this.screechFilter = null;

      this.initSynth();
    }

    initSynth() {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const unlock = () => {
        if (!this.ctx) {
          this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        if (!this.isUnlocked) {
          this.setupContinuousNodes();
          this.isUnlocked = true;
        }
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };

      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }

    setupContinuousNodes() {
      if (!this.ctx) return;

      try {
        // Engine sound generator
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.setValueAtTime(50, this.ctx.currentTime);

        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.setValueAtTime(240, this.ctx.currentTime);

        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime);

        this.engineOsc.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.ctx.destination);
        this.engineOsc.start();

        // Tire screech sound generator
        const bufferSize = this.ctx.sampleRate * 2;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }

        this.screechSource = this.ctx.createBufferSource();
        this.screechSource.buffer = noiseBuffer;
        this.screechSource.loop = true;

        this.screechFilter = this.ctx.createBiquadFilter();
        this.screechFilter.type = 'bandpass';
        this.screechFilter.frequency.setValueAtTime(1450, this.ctx.currentTime);
        this.screechFilter.Q.setValueAtTime(5.5, this.ctx.currentTime);

        this.screechGain = this.ctx.createGain();
        this.screechGain.gain.setValueAtTime(0, this.ctx.currentTime);

        this.screechSource.connect(this.screechFilter);
        this.screechFilter.connect(this.screechGain);
        this.screechGain.connect(this.ctx.destination);
        this.screechSource.start();
      } catch (e) {
        // Safe silent fail
      }
    }

    setMuted(muted) {
      this.muted = muted;
      localStorage.setItem(STORAGE_KEYS.AUDIO_MUTED, muted);
      if (this.muted) {
        if (this.engineGain && this.ctx) this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime);
        if (this.screechGain && this.ctx) this.screechGain.gain.setValueAtTime(0, this.ctx.currentTime);
        if (this.elBg) this.elBg.pause();
      }
    }

    updateEngine(speed, maxSpeed, isAccelerating) {
      if (this.muted) return;

      const normSpeed = Math.min(Math.abs(speed) / maxSpeed, 1.0);
      const targetFreq = 48 + normSpeed * 170 + (isAccelerating ? 30 : 0);
      const targetGain = 0.04 + normSpeed * 0.08;

      if (this.ctx && this.engineGain && this.engineOsc) {
        const now = this.ctx.currentTime;
        this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);
        this.engineGain.gain.setTargetAtTime(targetGain, now, 0.05);
        if (this.engineFilter) {
          this.engineFilter.frequency.setTargetAtTime(220 + normSpeed * 500, now, 0.08);
        }
      }

      // Safe HTML audio fallback
      if (this.elMove && isAccelerating && this.elMove.paused) {
        this.elMove.play().catch(() => {});
      }
    }

    stopEngine() {
      if (this.ctx && this.engineGain) {
        this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      }
    }

    updateScreech(isDrifting, intensity) {
      if (this.muted) return;

      if (this.ctx && this.screechGain) {
        const now = this.ctx.currentTime;
        const targetGain = isDrifting ? Math.min(intensity * 0.16, 0.18) : 0;
        this.screechGain.gain.setTargetAtTime(targetGain, now, 0.06);
        if (isDrifting && this.screechFilter) {
          this.screechFilter.frequency.setTargetAtTime(1100 + intensity * 600, now, 0.05);
        }
      }

      if (this.elScreech) {
        if (isDrifting && this.elScreech.paused) {
          this.elScreech.play().catch(() => {});
        } else if (!isDrifting && !this.elScreech.paused) {
          this.elScreech.pause();
        }
      }
    }

    playCrash() {
      if (this.muted) return;

      if (this.ctx) {
        try {
          const now = this.ctx.currentTime;
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(120, now);
          osc.frequency.exponentialRampToValueAtTime(32, now + 0.22);

          gain.gain.setValueAtTime(0.32, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(now);
          osc.stop(now + 0.26);
        } catch (e) {}
      }

      if (this.elCrash) {
        this.elCrash.currentTime = 0;
        this.elCrash.play().catch(() => {});
      }
    }

    playBank() {
      if (this.muted || !this.ctx) return;

      try {
        const now = this.ctx.currentTime;
        const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 arpeggio
        notes.forEach((freq, idx) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const t = now + idx * 0.07;

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t);

          gain.gain.setValueAtTime(0.12, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(t);
          osc.stop(t + 0.22);
        });
      } catch (e) {}
    }
  }

  // Track definitions and road rendering
  class TrackManager {
    constructor() {
      this.tracks = [
        {
          name: '1 · OVAL & HAIRPIN',
          subtitle: 'Wide arcs & gentle transitions',
          width: 130,
          spawn: { x: 480, y: 500, angle: Math.PI },
          controlPoints: [
            { x: 480, y: 500 },
            { x: 260, y: 500 },
            { x: 140, y: 440 },
            { x: 120, y: 300 },
            { x: 170, y: 160 },
            { x: 300, y: 90 },
            { x: 500, y: 90 },
            { x: 680, y: 120 },
            { x: 800, y: 220 },
            { x: 840, y: 360 },
            { x: 740, y: 480 }
          ]
        },
        {
          name: '2 · S-CHICANE',
          subtitle: 'Technical alternating flick-drifts',
          width: 115,
          spawn: { x: 480, y: 510, angle: Math.PI },
          controlPoints: [
            { x: 480, y: 510 },
            { x: 240, y: 510 },
            { x: 120, y: 410 },
            { x: 150, y: 260 },
            { x: 290, y: 230 },
            { x: 420, y: 310 },
            { x: 560, y: 310 },
            { x: 670, y: 220 },
            { x: 640, y: 110 },
            { x: 450, y: 80 },
            { x: 280, y: 90 },
            { x: 680, y: 80 },
            { x: 840, y: 180 },
            { x: 820, y: 380 },
            { x: 710, y: 490 }
          ]
        },
        {
          name: '3 · TOUGE CIRCUIT',
          subtitle: 'Tight mountain switchbacks & hairpins',
          width: 102,
          spawn: { x: 480, y: 520, angle: Math.PI },
          controlPoints: [
            { x: 480, y: 520 },
            { x: 220, y: 520 },
            { x: 100, y: 440 },
            { x: 110, y: 300 },
            { x: 250, y: 330 },
            { x: 370, y: 400 },
            { x: 520, y: 410 },
            { x: 640, y: 320 },
            { x: 720, y: 230 },
            { x: 840, y: 150 },
            { x: 760, y: 70 },
            { x: 580, y: 75 },
            { x: 470, y: 180 },
            { x: 340, y: 180 },
            { x: 230, y: 90 },
            { x: 120, y: 120 },
            { x: 850, y: 350 },
            { x: 700, y: 500 }
          ]
        }
      ];

      this.currentIdx = 0;
      this.splinePoints = [];
      this.bgImg = new Image();
      this.bgImg.src = './img/track.jpg';
      this.rebuildCurrentTrack();
    }

    setTrack(idx) {
      if (idx >= 0 && idx < this.tracks.length) {
        this.currentIdx = idx;
        this.rebuildCurrentTrack();
      }
    }

    getCurrentTrack() {
      return this.tracks[this.currentIdx];
    }

    // Catmull-Rom closed spline densification for silky smooth curves
    rebuildCurrentTrack() {
      const track = this.tracks[this.currentIdx];
      const pts = track.controlPoints;
      const numPts = pts.length;
      const interpolated = [];
      const stepsPerSegment = 24;

      for (let i = 0; i < numPts; i++) {
        const p0 = pts[(i - 1 + numPts) % numPts];
        const p1 = pts[i];
        const p2 = pts[(i + 1) % numPts];
        const p3 = pts[(i + 2) % numPts];

        for (let s = 0; s < stepsPerSegment; s++) {
          const t = s / stepsPerSegment;
          const t2 = t * t;
          const t3 = t2 * t;

          // Catmull-Rom formula
          const x = 0.5 * (
            (2 * p1.x) +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
          );
          const y = 0.5 * (
            (2 * p1.y) +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
          );

          interpolated.push({ x, y });
        }
      }

      this.splinePoints = interpolated;
    }

    // Mathematical distance check to track centerline
    checkCarOnTrack(carX, carY) {
      const track = this.getCurrentTrack();
      const halfWidth = track.width * 0.5;
      const pts = this.splinePoints;
      let minDistanceSq = Infinity;
      let closestIdx = 0;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const dx = carX - p.x;
        const dy = carY - p.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistanceSq) {
          minDistanceSq = distSq;
          closestIdx = i;
        }
      }

      const dist = Math.sqrt(minDistanceSq);
      const isOffTrack = dist > halfWidth;
      const isOnCurb = dist > halfWidth - 14 && dist <= halfWidth;
      const isWallHit = dist > halfWidth + 8;

      return {
        dist,
        isOffTrack,
        isOnCurb,
        isWallHit,
        closestIdx
      };
    }

    draw(ctx, theme) {
      const track = this.getCurrentTrack();
      const pts = this.splinePoints;
      if (!pts || pts.length < 2) return;

      const isDark = theme === 'dark';

      // 1. Infield / Ground Texture Background
      ctx.fillStyle = isDark ? '#0d1014' : '#e6eaef';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // User background texture if present
      if (this.bgImg && this.bgImg.complete && this.bgImg.naturalWidth > 0) {
        ctx.save();
        ctx.globalAlpha = isDark ? 0.35 : 0.12;
        ctx.drawImage(this.bgImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.restore();
      }

      // Subtle Infield Grid Lines
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.03)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_WIDTH, y);
        ctx.stroke();
      }

      // 2. Outer Barrier / Runoff Gravel outline
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Gravel / Runoff
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.closePath();
      ctx.lineWidth = track.width + 24;
      ctx.strokeStyle = isDark ? '#1a1d24' : '#d2d7df';
      ctx.stroke();

      // Red & White Apex Curbs
      ctx.lineWidth = track.width + 10;
      ctx.setLineDash([14, 14]);
      ctx.strokeStyle = '#ef4444'; // Red dashes
      ctx.stroke();

      ctx.lineDashOffset = 14;
      ctx.strokeStyle = '#ffffff'; // White dashes
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // 3. Main Asphalt Road Surface
      ctx.lineWidth = track.width;
      ctx.strokeStyle = isDark ? '#161920' : '#f0f3f8';
      ctx.stroke();

      // 4. Subtle Inner Road Racing Line (Center Dotted Dash)
      ctx.lineWidth = 2;
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
      ctx.setLineDash([16, 20]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 5. Start / Finish Line (Checkerboard Pattern)
      const startPt = track.spawn;
      ctx.save();
      ctx.translate(startPt.x, startPt.y);
      ctx.rotate(startPt.angle + Math.PI / 2);

      const checkW = 12;
      const checkH = track.width;
      const checkCols = 2;
      const checkRows = 10;
      const cellW = checkW / checkCols;
      const cellH = checkH / checkRows;

      for (let r = 0; r < checkRows; r++) {
        for (let c = 0; c < checkCols; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#ffffff' : '#111215';
          ctx.fillRect(-checkW / 2 + c * cellW, -checkH / 2 + r * cellH, cellW, cellH);
        }
      }
      ctx.restore();

      ctx.restore();
    }
  }

  // Particle system for smoke and sparks
  class ParticleSystem {
    constructor() {
      this.smokes = [];
      this.sparks = [];
      this.maxSmokes = 130;
    }

    addSmoke(x, y, vx, vy) {
      if (this.smokes.length >= this.maxSmokes) {
        this.smokes.shift();
      }
      this.smokes.push({
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: vx * 0.2 + (Math.random() - 0.5) * 0.8,
        vy: vy * 0.2 + (Math.random() - 0.5) * 0.8,
        radius: 4 + Math.random() * 3,
        maxRadius: 18 + Math.random() * 10,
        alpha: 0.52,
        growth: 0.45
      });
    }

    addSparks(x, y) {
      for (let i = 0; i < 14; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2 + Math.random() * 5;
        this.sparks.push({
          x,
          y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 1.0,
          decay: 0.04 + Math.random() * 0.04
        });
      }
    }

    update() {
      // Update smokes
      for (let i = this.smokes.length - 1; i >= 0; i--) {
        const s = this.smokes[i];
        s.x += s.vx;
        s.y += s.vy;
        s.radius += s.growth;
        s.alpha -= 0.016;
        if (s.alpha <= 0) {
          this.smokes.splice(i, 1);
        }
      }

      // Update sparks
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const p = this.sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) {
          this.sparks.splice(i, 1);
        }
      }
    }

    draw(ctx) {
      // Draw smoke
      ctx.save();
      for (let i = 0; i < this.smokes.length; i++) {
        const s = this.smokes[i];
        ctx.fillStyle = `rgba(235, 238, 245, ${Math.max(s.alpha, 0)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw sparks
      for (let i = 0; i < this.sparks.length; i++) {
        const p = this.sparks[i];
        ctx.fillStyle = `rgba(255, 180, 50, ${p.life})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    clear() {
      this.smokes = [];
      this.sparks = [];
    }
  }

  // Car sprite loader and vector renderer
  class CarRenderer {
    constructor() {
      this.images = {
        bmw: new Image(),
        car1: new Image(),
        car2: new Image()
      };

      // Load transparent PNGs with JPEG fallback
      this.loadImageWithFallback(this.images.bmw, './img/bmw.png', './img/bmw.jpg');
      this.loadImageWithFallback(this.images.car1, './img/car1.png', './img/car1.jpg');
      this.loadImageWithFallback(this.images.car2, './img/car2.png', './img/car2.jpg');

      this.currentType = localStorage.getItem(STORAGE_KEYS.CAR) || 'vector';
    }

    loadImageWithFallback(imgObj, primarySrc, fallbackSrc) {
      imgObj.src = primarySrc;
      imgObj.onerror = () => {
        imgObj.onerror = null;
        imgObj.src = fallbackSrc;
      };
    }

    setCarType(type) {
      this.currentType = type;
      localStorage.setItem(STORAGE_KEYS.CAR, type);
    }

    draw(ctx, car, theme) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(car.angle);

      const isBraking = car.controls.brake || car.controls.handbrake;

      // Draw Soft Drop Shadow underneath car
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
      ctx.beginPath();
      ctx.ellipse(0, 2, 26, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const img = this.images[this.currentType];
      const isImgReady = img && img.complete && img.naturalWidth > 0;

      if (this.currentType !== 'vector' && isImgReady) {
        // Draw car using image sprite
        const carLen = 52;
        const aspect = img.naturalHeight / img.naturalWidth;
        const carWid = Math.min(Math.max(carLen * aspect, 24), 30);

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(-carLen / 2, -carWid / 2, carLen, carWid, 6);
        ctx.clip();
        ctx.drawImage(img, -carLen / 2, -carWid / 2, carLen, carWid);
        ctx.restore();

        // Overlay Taillight brake indicators
        if (isBraking) {
          ctx.fillStyle = '#ff2222';
          ctx.shadowColor = '#ff2222';
          ctx.shadowBlur = 10;
          ctx.fillRect(-carLen / 2 - 1, -carWid / 2 + 3, 3, 5);
          ctx.fillRect(-carLen / 2 - 1, carWid / 2 - 8, 3, 5);
          ctx.shadowBlur = 0;
        }

        // Overlay Subtle Front LED Headlights
        ctx.fillStyle = '#f8fafc';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 4;
        ctx.fillRect(carLen / 2 - 3, -carWid / 2 + 4, 3, 3);
        ctx.fillRect(carLen / 2 - 3, carWid / 2 - 7, 3, 3);
        ctx.shadowBlur = 0;
      } else {
        // Draw car using vector graphics
        this.drawVectorCar(ctx, car, isBraking, theme);
      }

      ctx.restore();
    }

    drawVectorCar(ctx, car, isBraking, theme) {
      const length = 52;
      const width = 25;
      const halfL = length / 2;
      const halfW = width / 2;

      // 1. Wheels & Steering Angles
      const wheelW = 10;
      const wheelH = 4.5;
      const steerRad = car.steerAngle;

      ctx.fillStyle = '#1c1f26';

      // Front Wheels (Steerable)
      ctx.save();
      ctx.translate(halfL - 10, -halfW);
      ctx.rotate(steerRad);
      ctx.fillRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
      ctx.restore();

      ctx.save();
      ctx.translate(halfL - 10, halfW);
      ctx.rotate(steerRad);
      ctx.fillRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
      ctx.restore();

      // Rear Wheels (Fixed)
      ctx.fillRect(-halfL + 6 - wheelW / 2, -halfW - wheelH / 2, wheelW, wheelH);
      ctx.fillRect(-halfL + 6 - wheelW / 2, halfW - wheelH / 2, wheelW, wheelH);

      // 2. Aerodynamic Main Body
      const bodyGrad = ctx.createLinearGradient(-halfL, 0, halfL, 0);
      bodyGrad.addColorStop(0, '#e63920'); // Tail deep scarlet
      bodyGrad.addColorStop(0.65, '#ff5436'); // Vibrant race red
      bodyGrad.addColorStop(1, '#ff6e54'); // Nose highlight

      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      // Sleek drift silhouette
      ctx.moveTo(-halfL + 4, -halfW + 3);
      ctx.lineTo(halfL - 10, -halfW + 2);
      ctx.quadraticCurveTo(halfL, -halfW + 5, halfL, 0);
      ctx.quadraticCurveTo(halfL, halfW - 5, halfL - 10, halfW - 2);
      ctx.lineTo(-halfL + 4, halfW - 3);
      ctx.quadraticCurveTo(-halfL, 0, -halfL + 4, -halfW + 3);
      ctx.closePath();
      ctx.fill();

      // Body Outlines
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 3. Cabin Glass / Windshield
      ctx.fillStyle = '#141820';
      ctx.beginPath();
      ctx.moveTo(-8, -halfW + 5);
      ctx.lineTo(10, -halfW + 6);
      ctx.lineTo(13, 0);
      ctx.lineTo(10, halfW - 6);
      ctx.lineTo(-8, halfW - 5);
      ctx.quadraticCurveTo(-14, 0, -8, -halfW + 5);
      ctx.closePath();
      ctx.fill();

      // Glass Glare highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.beginPath();
      ctx.moveTo(-2, -halfW + 6);
      ctx.lineTo(6, -halfW + 6);
      ctx.lineTo(3, 0);
      ctx.lineTo(-4, 0);
      ctx.closePath();
      ctx.fill();

      // 4. Rear Carbon GT Wing / Spoiler
      ctx.fillStyle = '#101216';
      ctx.fillRect(-halfL, -halfW + 1, 4, width - 2);

      // 5. LED Headlights
      ctx.fillStyle = '#f8fafc';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 4;
      ctx.fillRect(halfL - 4, -halfW + 4, 3, 3);
      ctx.fillRect(halfL - 4, halfW - 7, 3, 3);
      ctx.shadowBlur = 0;

      // 6. Taillights (Intensify on Braking)
      if (isBraking) {
        ctx.fillStyle = '#ff1111';
        ctx.shadowColor = '#ff2222';
        ctx.shadowBlur = 12;
        ctx.fillRect(-halfL - 1, -halfW + 4, 3, 5);
        ctx.fillRect(-halfL - 1, halfW - 9, 3, 5);
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = '#aa1111';
        ctx.fillRect(-halfL, -halfW + 4, 2, 4);
        ctx.fillRect(-halfL, halfW - 8, 2, 4);
      }
    }
  }

  // Car physics and drift slip angle calculations
  class Car {
    constructor(x, y, angle) {
      this.reset(x, y, angle);
    }

    reset(x, y, angle) {
      this.x = x || 480;
      this.y = y || 500;
      this.angle = angle !== undefined ? angle : Math.PI;

      this.vx = 0;
      this.vy = 0;
      this.angularVelocity = 0;
      this.steerAngle = 0;

      // Physics parameters
      this.maxSpeed = 7.6;
      this.accel = 0.19;
      this.brake = 0.29;
      this.friction = 0.984; // forward rolling resistance

      // Slip / Drift state
      this.slipAngle = 0;
      this.isDrifting = false;
      this.driftDuration = 0;

      // Inputs
      this.controls = {
        gas: false,
        brake: false,
        left: false,
        right: false,
        handbrake: false
      };
    }

    update(dt) {
      // 1. Steering computation modulated by speed
      const targetSteer = (this.controls.left ? -0.55 : 0) + (this.controls.right ? 0.55 : 0);
      this.steerAngle += (targetSteer - this.steerAngle) * 0.22;

      // Forward and lateral unit vectors
      const fwdX = Math.cos(this.angle);
      const fwdY = Math.sin(this.angle);
      const latX = -Math.sin(this.angle);
      const latY = Math.cos(this.angle);

      // Decompose current velocity into forward and lateral components
      const vFwd = this.vx * fwdX + this.vy * fwdY;
      const vLat = this.vx * latX + this.vy * latY;

      // 2. Throttle & Braking forces
      let newFwd = vFwd;

      if (this.controls.gas) {
        newFwd += this.accel;
        if (newFwd > this.maxSpeed) newFwd = this.maxSpeed;
      }

      if (this.controls.brake) {
        if (newFwd > 0.3) {
          newFwd -= this.brake;
        } else {
          // Reverse gear capped at 35% speed
          newFwd -= this.accel * 0.7;
          if (newFwd < -this.maxSpeed * MAX_REVERSE_RATIO) {
            newFwd = -this.maxSpeed * MAX_REVERSE_RATIO;
          }
        }
      }

      // Handbrake reduces forward speed slightly
      if (this.controls.handbrake) {
        newFwd *= 0.96;
      }

      // Apply rolling friction
      newFwd *= this.friction;

      // 3. Lateral grip & Handbrake traction reduction
      let lateralGrip = 0.88;
      if (this.controls.handbrake) {
        lateralGrip = 0.56; // Sharply reduces rear-wheel lateral traction
      }

      let newLat = vLat * lateralGrip;

      // 4. Turning dynamics based on forward velocity
      const speedRatio = Math.min(Math.abs(newFwd) / this.maxSpeed, 1.0);
      const turnPower = (newFwd >= 0 ? 1 : -1) * (0.046 * speedRatio);
      
      // Handbrake kicks out tail into a slide
      const handbrakeYaw = this.controls.handbrake ? (this.steerAngle * 0.038) : 0;
      this.angle += (this.steerAngle * turnPower) + handbrakeYaw;

      // 5. Recombine forward and lateral velocities into world coordinates
      this.vx = fwdX * newFwd + latX * newLat;
      this.vy = fwdY * newFwd + latY * newLat;

      // Position step
      this.x += this.vx;
      this.y += this.vy;

      // 6. Slip Angle Formula:
      // Slip Angle = Angle difference between car heading and actual velocity vector
      const totalSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (totalSpeed > 0.6) {
        const motionAngle = Math.atan2(this.vy, this.vx);
        let diff = this.angle - motionAngle;
        // Normalize to [-PI, PI]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.slipAngle = Math.abs(diff);
      } else {
        this.slipAngle = 0;
      }

      // Drift State Trigger
      if (this.slipAngle > DRIFT_ANGLE_THRESHOLD && totalSpeed > DRIFT_MIN_SPEED) {
        this.isDrifting = true;
        this.driftDuration += dt;
      } else {
        this.isDrifting = false;
        this.driftDuration = 0;
      }
    }

    getRearTirePositions() {
      const cosA = Math.cos(this.angle);
      const sinA = Math.sin(this.angle);
      const backDist = 18;
      const sideDist = 11;

      // Center back of car
      const cx = this.x - cosA * backDist;
      const cy = this.y - sinA * backDist;

      // Left and right rear tires
      return {
        left: {
          x: cx - sinA * sideDist,
          y: cy + cosA * sideDist
        },
        right: {
          x: cx + sinA * sideDist,
          y: cy - cosA * sideDist
        }
      };
    }
  }

  // Main game engine controller
  class DriftKingEngine {
    constructor() {
      this.canvas = document.getElementById('gameCanvas');
      this.ctx = this.canvas.getContext('2d', { alpha: false });

      // Offscreen Skidmarks Canvas Buffer (for permanent/fading tire marks)
      this.skidCanvas = document.createElement('canvas');
      this.skidCanvas.width = CANVAS_WIDTH;
      this.skidCanvas.height = CANVAS_HEIGHT;
      this.skidCtx = this.skidCanvas.getContext('2d');

      // Managers & Components
      this.audio = new AudioManager();
      this.trackMgr = new TrackManager();
      this.carRenderer = new CarRenderer();
      this.particles = new ParticleSystem();

      // State machine: 'idle', 'playing', 'paused', 'crashed'
      this.state = 'idle';

      // Scoring & Combo Bank System
      this.score = 0;
      this.comboScore = 0;
      this.multiplier = 1.0;
      this.maxComboSeen = 1.0;
      this.bestScore = parseInt(localStorage.getItem(STORAGE_KEYS.BEST_SCORE) || '0', 10);
      this.bankGraceCountdown = 0;

      // Lap tracking
      this.lapCount = 0;
      this.lastSpawnDist = 999;

      // Screen shake
      this.shakeIntensity = 0;

      // Floating messages (+PTS BANKED, etc.)
      this.floatingMessages = [];

      // Theme
      this.theme = localStorage.getItem(STORAGE_KEYS.THEME) || 'dark';

      // Initialize Car
      const spawn = this.trackMgr.getCurrentTrack().spawn;
      this.car = new Car(spawn.x, spawn.y, spawn.angle);

      // Restore saved track & car
      const savedTrack = parseInt(localStorage.getItem(STORAGE_KEYS.TRACK) || '0', 10);
      this.switchTrack(savedTrack, false);

      const savedCar = localStorage.getItem(STORAGE_KEYS.CAR) || 'vector';
      this.switchCar(savedCar, false);

      // DOM Bindings & Events
      this.bindDOM();
      this.bindControls();
      this.applyTheme(this.theme);
      this.updateScoreboard();

      // Start RAF Loop
      this.lastTime = performance.now();
      requestAnimationFrame(this.loop.bind(this));
    }

    bindDOM() {
      // Overlays
      this.startOverlay = document.getElementById('startOverlay');
      this.pauseOverlay = document.getElementById('pauseOverlay');
      this.resultsOverlay = document.getElementById('resultsOverlay');

      // Buttons
      document.getElementById('startBtn').addEventListener('click', () => this.startGame());
      document.getElementById('resumeBtn').addEventListener('click', () => this.resumeGame());
      document.getElementById('restartBtn').addEventListener('click', () => this.resetRun());
      document.getElementById('driveAgainBtn').addEventListener('click', () => this.restartFromResults());
      document.getElementById('pauseToggleBtn').addEventListener('click', () => this.togglePause());
      document.getElementById('resetRunBtn').addEventListener('click', () => this.resetRun());

      // Theme & Audio Toggles
      document.getElementById('themeToggleBtn').addEventListener('click', () => this.toggleTheme());
      document.getElementById('audioToggleBtn').addEventListener('click', () => this.toggleAudio());

      // Track & Car Selectors
      this.trackSelect = document.getElementById('trackSelect');
      this.trackSelect.value = this.trackMgr.currentIdx.toString();
      this.trackSelect.addEventListener('change', (e) => this.switchTrack(parseInt(e.target.value, 10), true));

      this.carSelect = document.getElementById('carSelect');
      this.carSelect.value = this.carRenderer.currentType;
      this.carSelect.addEventListener('change', (e) => this.switchCar(e.target.value, true));

      // Status Badge
      this.statusBadge = document.getElementById('statusBadge');
      this.statusText = document.getElementById('statusText');

      // Score Elements
      this.scoreDisplay = document.getElementById('scoreDisplay');
      this.comboDisplay = document.getElementById('comboDisplay');
      this.multiplierDisplay = document.getElementById('multiplierDisplay');
      this.bestScoreDisplay = document.getElementById('bestScoreDisplay');
      this.comboPill = document.getElementById('comboPill');

      // Results Elements
      this.finalScoreVal = document.getElementById('finalScoreVal');
      this.maxComboVal = document.getElementById('maxComboVal');
      this.bestRecordVal = document.getElementById('bestRecordVal');
    }

    bindControls() {
      const setKey = (code, val) => {
        switch (code) {
          case 'KeyW':
          case 'ArrowUp':
            this.car.controls.gas = val;
            break;
          case 'KeyS':
          case 'ArrowDown':
            this.car.controls.brake = val;
            break;
          case 'KeyA':
          case 'ArrowLeft':
            this.car.controls.left = val;
            break;
          case 'KeyD':
          case 'ArrowRight':
            this.car.controls.right = val;
            break;
          case 'Space':
            this.car.controls.handbrake = val;
            break;
        }
      };

      window.addEventListener('keydown', (e) => {
        // Prevent window scrolling on arrow keys & space
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          e.preventDefault();
        }

        if (this.state === 'idle' && ['Space', 'Enter', 'KeyW', 'ArrowUp'].includes(e.code)) {
          this.startGame();
          return;
        }

        if (e.code === 'KeyP' || e.code === 'Escape') {
          this.togglePause();
          return;
        }

        if (e.code === 'KeyR') {
          this.resetRun();
          return;
        }

        setKey(e.code, true);
      });

      window.addEventListener('keyup', (e) => {
        setKey(e.code, false);
      });

      // Mobile Touch Controls Binding
      const bindTouch = (elemId, controlKey) => {
        const btn = document.getElementById(elemId);
        if (!btn) return;

        const start = (e) => {
          e.preventDefault();
          this.car.controls[controlKey] = true;
          if (this.state === 'idle') this.startGame();
        };

        const end = (e) => {
          e.preventDefault();
          this.car.controls[controlKey] = false;
        };

        btn.addEventListener('touchstart', start, { passive: false });
        btn.addEventListener('touchend', end, { passive: false });
        btn.addEventListener('touchcancel', end, { passive: false });
        btn.addEventListener('mousedown', start);
        btn.addEventListener('mouseup', end);
        btn.addEventListener('mouseleave', end);
      };

      bindTouch('touchSteerLeft', 'left');
      bindTouch('touchSteerRight', 'right');
      bindTouch('touchGas', 'gas');
      bindTouch('touchBrake', 'brake');
      bindTouch('touchDrift', 'handbrake');
    }

    startGame() {
      this.state = 'playing';
      this.startOverlay.classList.remove('active');
      this.pauseOverlay.classList.remove('active');
      this.resultsOverlay.classList.remove('active');
      this.setStatus('READY', 'ready');
      document.getElementById('pauseBtnLabel').textContent = 'PAUSE';
    }

    pauseGame() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.pauseOverlay.classList.add('active');
      document.getElementById('pauseBtnLabel').textContent = 'RESUME';
      this.audio.stopEngine();
      this.audio.updateScreech(false, 0);
    }

    resumeGame() {
      if (this.state !== 'paused') return;
      this.state = 'playing';
      this.pauseOverlay.classList.remove('active');
      document.getElementById('pauseBtnLabel').textContent = 'PAUSE';
    }

    togglePause() {
      if (this.state === 'playing') {
        this.pauseGame();
      } else if (this.state === 'paused') {
        this.resumeGame();
      }
    }

    finishRun() {
      this.state = 'idle';
      this.resultsOverlay.classList.add('active');
      this.finalScoreVal.textContent = Math.floor(this.score).toLocaleString();
      this.maxComboVal.textContent = `${this.maxComboSeen.toFixed(1)}×`;
      this.bestRecordVal.textContent = Math.floor(this.bestScore).toLocaleString();
      this.audio.stopEngine();
      this.audio.updateScreech(false, 0);
    }

    restartFromResults() {
      this.resultsOverlay.classList.remove('active');
      this.resetRun();
      this.startGame();
    }

    resetRun() {
      const spawn = this.trackMgr.getCurrentTrack().spawn;
      this.car.reset(spawn.x, spawn.y, spawn.angle);

      // Bank or clear points
      this.score = 0;
      this.comboScore = 0;
      this.multiplier = 1.0;
      this.bankGraceCountdown = 0;
      this.lapCount = 0;

      // Clear particles & skidmarks
      this.particles.clear();
      this.skidCtx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      this.floatingMessages = [];

      this.updateScoreboard();
      this.setStatus('READY', 'ready');

      if (this.state === 'paused') {
        this.resumeGame();
      }
    }

    switchTrack(idx, shouldReset = true) {
      this.trackMgr.setTrack(idx);
      localStorage.setItem(STORAGE_KEYS.TRACK, idx);
      if (this.trackSelect) this.trackSelect.value = idx.toString();
      if (shouldReset) {
        this.resetRun();
      }
    }

    switchCar(type, shouldUpdate = true) {
      this.carRenderer.setCarType(type);
      if (this.carSelect) this.carSelect.value = type;
    }

    toggleTheme() {
      const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(nextTheme);
    }

    applyTheme(theme) {
      this.theme = theme;
      localStorage.setItem(STORAGE_KEYS.THEME, theme);
      document.documentElement.setAttribute('data-theme', theme);

      const icon = document.getElementById('themeIcon');
      const label = document.getElementById('themeLabel');
      if (theme === 'dark') {
        icon.textContent = '🌙';
        label.textContent = 'DARK';
      } else {
        icon.textContent = '☀️';
        label.textContent = 'LIGHT';
      }
    }

    toggleAudio() {
      const isMuted = !this.audio.muted;
      this.audio.setMuted(isMuted);

      const icon = document.getElementById('audioIcon');
      const label = document.getElementById('audioLabel');
      if (isMuted) {
        icon.textContent = '🔇';
        label.textContent = 'MUTED';
      } else {
        icon.textContent = '🔊';
        label.textContent = 'AUDIO';
      }
    }

    setStatus(text, type) {
      this.statusText.textContent = text;
      this.statusBadge.className = `status-badge status-${type}`;
    }

    // Floating text notification queue (+PTS BANKED, WALL HIT)
    addFloatingMessage(text, color, x, y) {
      this.floatingMessages.push({
        text,
        color,
        x: x || this.car.x,
        y: (y || this.car.y) - 20,
        alpha: 1.0,
        vy: -1.2
      });
    }

    // Main game loop: update physics and render frame
    loop(currentTime) {
      const dt = Math.min((currentTime - this.lastTime) / 1000, 0.1);
      this.lastTime = currentTime;

      if (this.state === 'playing') {
        this.update(dt);
      }

      this.render();
      requestAnimationFrame(this.loop.bind(this));
    }

    update(dt) {
      // 1. Update Car Physics
      this.car.update(dt);

      const speed = Math.sqrt(this.car.vx * this.car.vx + this.car.vy * this.car.vy);
      const isAcc = this.car.controls.gas;

      // 2. Audio Engine Pitch and Screech
      this.audio.updateEngine(speed, this.car.maxSpeed, isAcc);

      // 3. Track Boundary Collision Check
      const trackCheck = this.trackMgr.checkCarOnTrack(this.car.x, this.car.y);

      if (trackCheck.isWallHit) {
        // Wall collision penalty
        this.shakeIntensity = 14;
        this.audio.playCrash();
        this.particles.addSparks(this.car.x, this.car.y);

        // Reverse bounce impulse & reduce speed
        this.car.vx *= -0.4;
        this.car.vy *= -0.4;
        this.car.x += this.car.vx * 2;
        this.car.y += this.car.vy * 2;

        // Reset unbanked combo points with warning!
        if (this.comboScore > 0) {
          this.addFloatingMessage('COMBO WIPED!', '#ef4444');
        }
        this.comboScore = 0;
        this.multiplier = 1.0;
        this.bankGraceCountdown = 0;
        this.setStatus('WALL HIT!', 'wall');
      } else if (this.car.isDrifting) {
        // Active drift state and scoring
        // Drift formula: Points = Speed * |sin(Slip Angle)| * Multiplier
        const driftPointsRate = speed * Math.abs(Math.sin(this.car.slipAngle)) * 4.6;
        this.comboScore += driftPointsRate * this.multiplier;

        // Calculate Multiplier increase based on sustained drift duration
        if (this.car.driftDuration > 6.0) {
          this.multiplier = 4.0;
        } else if (this.car.driftDuration > 4.0) {
          this.multiplier = 3.0;
        } else if (this.car.driftDuration > 2.2) {
          this.multiplier = 2.0;
        } else if (this.car.driftDuration > 1.0) {
          this.multiplier = 1.5;
        }

        if (this.multiplier > this.maxComboSeen) {
          this.maxComboSeen = this.multiplier;
        }

        this.bankGraceCountdown = BANK_GRACE_TIME;
        this.setStatus(`DRIFTING (${this.multiplier.toFixed(1)}×)`, 'drifting');

        // Audio screech
        this.audio.updateScreech(true, Math.abs(Math.sin(this.car.slipAngle)));

        // Spawn Smoke & Skidmarks from Rear Tires
        const tires = this.car.getRearTirePositions();
        this.particles.addSmoke(tires.left.x, tires.left.y, this.car.vx, this.car.vy);
        this.particles.addSmoke(tires.right.x, tires.right.y, this.car.vx, this.car.vy);

        // Draw onto skidmark canvas buffer
        this.skidCtx.fillStyle = 'rgba(20, 20, 25, 0.12)';
        this.skidCtx.beginPath();
        this.skidCtx.arc(tires.left.x, tires.left.y, 3, 0, Math.PI * 2);
        this.skidCtx.arc(tires.right.x, tires.right.y, 3, 0, Math.PI * 2);
        this.skidCtx.fill();
      } else {
        // Stop tire screech sound
        this.audio.updateScreech(false, 0);

        // Bank mechanic: safe drift banking
        // Straightening the car without crashing banks the points into total score
        if (this.comboScore > 0) {
          this.bankGraceCountdown -= dt;
          if (this.bankGraceCountdown <= 0) {
            // Safe Banking Triggered!
            const bankedPts = Math.round(this.comboScore);
            this.score += bankedPts;
            this.addFloatingMessage(`+${bankedPts.toLocaleString()} BANKED!`, '#10b981');
            this.audio.playBank();
            this.setStatus('BANKED!', 'banked');

            // Save High Score
            if (this.score > this.bestScore) {
              this.bestScore = this.score;
              localStorage.setItem(STORAGE_KEYS.BEST_SCORE, Math.floor(this.bestScore));
            }

            // Reset combo
            this.comboScore = 0;
            this.multiplier = 1.0;
          }
        } else if (this.statusBadge.classList.contains('status-wall') || this.statusBadge.classList.contains('status-banked')) {
          // Return to Ready badge
          this.setStatus('READY', 'ready');
        }
      }

      // 4. Update Particle Physics
      this.particles.update();

      // 5. Update Floating Messages
      for (let i = this.floatingMessages.length - 1; i >= 0; i--) {
        const msg = this.floatingMessages[i];
        msg.y += msg.vy;
        msg.alpha -= 0.018;
        if (msg.alpha <= 0) {
          this.floatingMessages.splice(i, 1);
        }
      }

      // 6. Slowly fade old skidmarks buffer
      if (Math.random() < 0.06) {
        this.skidCtx.fillStyle = 'rgba(255, 255, 255, 0.008)';
        this.skidCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }

      // 7. Screen Shake Decay
      if (this.shakeIntensity > 0) {
        this.shakeIntensity *= 0.88;
        if (this.shakeIntensity < 0.2) this.shakeIntensity = 0;
      }

      // 8. Update UI Scoreboard
      this.updateScoreboard();
    }

    updateScoreboard() {
      this.scoreDisplay.textContent = Math.floor(this.score).toLocaleString();
      this.comboDisplay.textContent = Math.floor(this.comboScore).toLocaleString();
      this.multiplierDisplay.textContent = `${this.multiplier.toFixed(1)}×`;
      this.bestScoreDisplay.textContent = Math.floor(this.bestScore).toLocaleString();

      if (this.car.isDrifting) {
        this.comboPill.classList.add('active-drift');
      } else {
        this.comboPill.classList.remove('active-drift');
      }
    }

    render() {
      this.ctx.save();

      // Apply Screen Shake if active
      if (this.shakeIntensity > 0) {
        const ox = (Math.random() - 0.5) * this.shakeIntensity;
        const oy = (Math.random() - 0.5) * this.shakeIntensity;
        this.ctx.translate(ox, oy);
      }

      // 1. Draw Procedural Track (Surface, curbs, checkpoints)
      this.trackMgr.draw(this.ctx, this.theme);

      // 2. Draw Skidmarks Buffer
      this.ctx.drawImage(this.skidCanvas, 0, 0);

      // 3. Draw Tire Smoke & Sparks Particles
      this.particles.draw(this.ctx);

      // 4. Draw Player Car
      this.carRenderer.draw(this.ctx, this.car, this.theme);

      // 5. Draw Floating Notifications & Bank Animations
      this.drawFloatingMessages();

      // 6. Draw In-Canvas Telemetry HUD (Minimalist corner gauge)
      this.drawHUD();

      this.ctx.restore();
    }

    drawFloatingMessages() {
      this.ctx.save();
      this.ctx.font = '700 14px ui-monospace, "SF Mono", monospace';
      this.ctx.textAlign = 'center';

      for (let i = 0; i < this.floatingMessages.length; i++) {
        const msg = this.floatingMessages[i];
        this.ctx.fillStyle = msg.color;
        this.ctx.globalAlpha = Math.max(msg.alpha, 0);
        this.ctx.shadowColor = msg.color;
        this.ctx.shadowBlur = 8;
        this.ctx.fillText(msg.text, msg.x, msg.y);
      }
      this.ctx.restore();
    }

    drawHUD() {
      this.ctx.save();
      const speedKmH = Math.round(Math.sqrt(this.car.vx * this.car.vx + this.car.vy * this.car.vy) * 18);
      const slipDeg = Math.round(this.car.slipAngle * (180 / Math.PI));

      // Telemetry Box at Bottom-Left of viewport
      const hudX = 22;
      const hudY = CANVAS_HEIGHT - 38;

      this.ctx.font = '700 11px ui-monospace, "SF Mono", monospace';
      this.ctx.fillStyle = this.theme === 'dark' ? 'rgba(240, 242, 245, 0.75)' : 'rgba(20, 25, 35, 0.75)';
      this.ctx.fillText(`SPEED: ${speedKmH} KM/H  |  SLIP: ${slipDeg}°`, hudX, hudY);

      // Mini Drift Angle Meter
      if (this.car.isDrifting) {
        this.ctx.fillStyle = '#ffaa1d';
        this.ctx.fillText('DRIFT DETECTED', hudX, hudY + 16);
      }

      this.ctx.restore();
    }
  }

  // Auto-boot engine on DOMContentLoaded
  window.addEventListener('DOMContentLoaded', () => {
    window.driftKing = new DriftKingEngine();
  });
})();
