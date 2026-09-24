sap.ui.define([], function() {

   "use strict";

   /** Client-side evaluation of streamed motion.
     *
     * The server may describe an element not by where it is but by how it is
     * moving -- REveElement::SetMotion -- sending position (in the usual
     * transformation matrix), velocity, acceleration, and a window `max_dt`
     * for how long the trajectory may be trusted. This evaluates
     *
     *     p(t) = p0 + v*dt + 0.5*a*dt^2,   dt = min(now - t0, max_dt)
     *
     * every frame, so the object moves smoothly between updates and the update
     * rate stops being visible. Under constant acceleration that is the exact
     * trajectory, not an approximation.
     *
     * Rotation is extrapolated too, from an angular velocity in the world
     * frame -- axis by direction, rad/s by length. It has to be: a spinning
     * object whose flight is smooth but whose spin jumps once per update looks
     * WORSE than one that does neither, because the two disagree and the jump
     * is what the eye follows.
     *
     * Scale is not extrapolated and does not need to be -- it rides in the
     * rotated columns, and a rotation preserves their lengths.
     */
   class Motion {

      constructor(viewer) {
         this.viewer  = viewer;
         this.objects = new Map();   // element id -> entry
         this.offset  = null;        // performance.now() - server ms
         this.raf     = 0;
         this.enabled = true;

         /** Cap on applied updates per second; 0 freezes. See setMaxHz(). */
         this.max_hz    = 60;
         this._last_app = 0;
         /** The message the last accept/drop decision was made for, and what it
           * was -- so every element in one message shares one decision. */
         this._msg_t    = null;
         this._msg_ok   = false;

         /** Cap on animation-driven redraws per second; 0 is uncapped. */
         this.render_max_hz = 0;
         this._last_render  = 0;
         this._pending      = 0;
      }

      /** How often this viewer may apply streamed motion, from
        * REveViewer::SetMotionMaxHz. Zero freezes it where it stands.
        *
        * Not the same knob as setEnabled(). That one only decides whether the
        * client draws BETWEEN updates; with it off an object still steps along
        * at whatever rate the server sends, which is why turning it off does
        * not read as "stop". This is the one that stops it -- and at zero it
        * also stops extrapolating, since continuing to evaluate a trajectory
        * while refusing its updates would be the worst of both.
        */
      setMaxHz(hz) {
         hz = (hz >= 0) ? hz : 60;
         if (hz === this.max_hz) return;
         this.max_hz = hz;

         if (hz === 0) this.stop();
         else          this.start();
      }

      /** How often the animation loop may redraw, from
        * REveViewer::SetRenderMaxHz. Zero is uncapped -- every display frame.
        *
        * This is the cheap knob. A render costs almost the same whatever is in
        * the scene -- nearly all of it is the renderer's fixed per-pass work --
        * so halving the frame rate halves the cost, and smooth at 30 is hard to
        * tell from smooth at 60.
        *
        * The trajectory is still evaluated at the moment it is drawn, so a
        * capped viewer is not behind, only coarser.
        */
      setRenderMaxHz(hz) {
         this.render_max_hz = (hz > 0) ? hz : 0;
      }

      /** Ask for a redraw, subject to the cap.
        *
        * Everything that redraws because motion changed goes through here --
        * the animation loop AND an arriving update. Capping only the loop
        * leaves the stream redrawing at its own rate, which is how the first
        * version of this measured 6 frames a second under a cap of 2.
        *
        * A suppressed request is not dropped but deferred: without the trailing
        * timer the newest state could sit undrawn indefinitely, which is what
        * would happen to the last update before a scene goes still -- and with
        * extrapolation off there is no loop coming along later to draw it.
        */
      requestRender() {
         if (this.render_max_hz <= 0) { this.viewer.request_render(); return; }

         const now  = performance.now();
         const gap  = 1000 / this.render_max_hz;
         const wait = gap - (now - this._last_render);

         if (wait <= 0) {
            this._last_render = now;
            this.viewer.request_render();
            return;
         }

         if (!this._pending) {
            this._pending = setTimeout(() => {
               this._pending = 0;
               this._last_render = performance.now();
               this.viewer.request_render();
            }, wait);
         }
      }

      /** Gate for an incoming update: false means drop it.
        *
        * Decided once per MESSAGE, not per element -- `t` is the server
        * timestamp the whole message carries, and every element in it gets the
        * same answer.
        *
        * Per element it is wrong, and wrong in a way that looks like a dead
        * object rather than a throttle: the elements of one message arrive
        * microseconds apart, so the first spends the budget and every later one
        * is refused, every time, for ever. In boing.C that was the ball moving
        * and the shadow sitting where it had been at connect time.
        */
      acceptUpdate(t) {
         if (this.max_hz === 0) return false;

         if (t !== undefined && t === this._msg_t)
            return this._msg_ok;

         const now = performance.now();
         const ok  = (now - this._last_app) >= 1000 / this.max_hz;
         if (ok) this._last_app = now;

         this._msg_t  = t;
         this._msg_ok = ok;
         return ok;
      }

      /** Per-viewer switch, from REveViewer::SetExtrapolateMotion.
        *
        * Off holds every object where its last update put it, which is what the
        * scene looked like before any of this existed -- and is the way to see
        * the real update rate when the motion looks wrong and the question is
        * whether the stream or the extrapolation is at fault.
        *
        * Turning it off snaps each object back to the position the server last
        * sent, rather than leaving it wherever the extrapolation had got to.
        */
      setEnabled(on) {
         on = !!on;
         if (on === this.enabled) return;
         this.enabled = on;

         if (on) {
            this.start();
         } else {
            this.stop();
            for (const e of this.objects.values()) {
               const m = e.obj3d._matrix.elements, r = e.r0;
               m[12] = e.p0[0]; m[13] = e.p0[1]; m[14] = e.p0[2];
               for (let cIdx = 0; cIdx < 3; ++cIdx) {
                  const o = cIdx * 4;
                  m[o] = r[cIdx*3]; m[o+1] = r[cIdx*3+1]; m[o+2] = r[cIdx*3+2];
               }
               e.obj3d.matrixChanged();
            }
            this.viewer.request_render();
         }
      }

      //--------------------------------------------------------------------
      // The shared clock
      //--------------------------------------------------------------------

      /** Feed one observation of the server clock.
        *
        * Each sample is `performance.now() - t0`, which is the true offset plus
        * the one-way delay plus however long this client took to get round to
        * looking at it. Those addenda are all positive and all variable, so the
        * SMALLEST sample seen is the least contaminated -- the same reasoning
        * NTP uses when it keeps the exchange with the lowest round-trip.
        *
        * Taking a hard minimum forever would let one unusually quick sample pin
        * the estimate below the truth for the life of the session, and would
        * never recover from clock drift, so it creeps back up very slowly when
        * every sample is above it.
        *
        * What survives is a constant lead or lag of about the one-way latency.
        * That is the right error to be left with: it shifts everything equally
        * and shows up as the scene being uniformly slightly behind, not as
        * objects jittering against each other.
        */
      noteServerTime(t0) {
         const s = performance.now() - t0;

         if (this.offset === null || s < this.offset)
            this.offset = s;
         else
            this.offset += (s - this.offset) * 0.0005;
      }

      serverNow() {
         return (this.offset === null) ? 0 : performance.now() - this.offset;
      }

      //--------------------------------------------------------------------

      /** Take the `mot` block of a transformation update. Null clears it. */
      update(id, obj3d, mot) {
         if (!mot) { this.remove(id); return; }

         this.noteServerTime(mot.t0);

         const m = obj3d._matrix ? obj3d._matrix.elements : null;
         if (!m) return;

         this.objects.set(id, {
            obj3d:  obj3d,
            // Where the server says it was at t0 -- the matrix it sent in the
            // same message, before anything here has touched it. The rotation
            // is kept as the three basis columns, scale and all.
            p0:     [m[12], m[13], m[14]],
            r0:     [m[0], m[1], m[2],  m[4], m[5], m[6],  m[8], m[9], m[10]],
            t0:     mot.t0,
            vel:    mot.vel,
            acc:    mot.acc,
            axis:   mot.axis  || [0, 0, 1],
            rate:   mot.rate  || 0,
            max_dt: mot.max_dt
         });

         this.start();
      }

      remove(id) {
         this.objects.delete(id);
      }

      clear() {
         this.objects.clear();
         this.stop();
      }

      //--------------------------------------------------------------------

      start() {
         if (this.raf || this.objects.size === 0 || !this.enabled || this.max_hz === 0) return;
         this.raf = requestAnimationFrame(this.tick.bind(this));
      }

      stop() {
         if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
         if (this._pending) { clearTimeout(this._pending); this._pending = 0; }
      }

      tick() {
         this.raf = 0;
         if (this.objects.size === 0) return;

         // Skip the work entirely on a frame we are not going to draw. Not just
         // the render -- evaluating positions nobody sees is waste too, and the
         // next frame we do draw evaluates for ITS own instant, so nothing is
         // lost by having missed this one.
         const now = performance.now();
         const due = (this.render_max_hz === 0) ||
                     (now - this._last_render >= 1000 / this.render_max_hz);

         if (due && this.apply())
            this.requestRender();

         this.raf = requestAnimationFrame(this.tick.bind(this));
      }

      /** Place every moving object for the current instant.
        * Returns true if anything actually moved. */
      apply() {
         const now = this.serverNow();
         let moved = false;

         for (const e of this.objects.values()) {
            let dt = (now - e.t0) / 1000;         // seconds

            // Before t0 means the estimate is running ahead of the server;
            // hold at the start of the trajectory rather than run it backwards.
            if (dt < 0) dt = 0;

            // The window. Past it the client has no business guessing, so it
            // stops at the last point the server vouched for. A stalled link
            // freezes the object, which is visible and honest; without this it
            // would coast on through whatever was about to happen to it.
            if (dt > e.max_dt) dt = e.max_dt;

            const m = e.obj3d._matrix.elements;
            const x = e.p0[0] + e.vel[0] * dt + 0.5 * e.acc[0] * dt * dt;
            const y = e.p0[1] + e.vel[1] * dt + 0.5 * e.acc[1] * dt * dt;
            const z = e.p0[2] + e.vel[2] * dt + 0.5 * e.acc[2] * dt * dt;

            let touched = false;

            if (m[12] !== x || m[13] !== y || m[14] !== z) {
               m[12] = x; m[13] = y; m[14] = z;
               touched = true;
            }

            // Spin: turn the stored basis by rate*dt about the axis. One
            // Rodrigues rotation, so there is no axis ordering. The axis is in
            // the LOCAL frame, so R composes on the RIGHT of the base basis:
            // each new column is a combination of the old columns. The server
            // sends the axis normalised.
            if (e.rate !== 0) {
               const th = e.rate * dt;
               const ux = e.axis[0], uy = e.axis[1], uz = e.axis[2];
               const c = Math.cos(th), s = Math.sin(th), t = 1 - c;

               // Rodrigues, row-major.
               const R = [t*ux*ux + c,      t*ux*uy - s*uz,  t*ux*uz + s*uy,
                          t*ux*uy + s*uz,   t*uy*uy + c,     t*uy*uz - s*ux,
                          t*ux*uz - s*uy,   t*uy*uz + s*ux,  t*uz*uz + c];

               // new_col[j] = sum_k old_col[k] * R[k][j]. Column lengths survive
               // while the basis scale is uniform, which is what a local-frame
               // spin needs; a non-uniform scale would shear.
               const r = e.r0;
               for (let j = 0; j < 3; ++j) {
                  const o = j * 4;
                  for (let i = 0; i < 3; ++i)
                     m[o + i] = r[i] * R[j] + r[3 + i] * R[3 + j] + r[6 + i] * R[6 + j];
               }
               touched = true;
            }

            if (touched) { e.obj3d.matrixChanged(); moved = true; }
         }
         return moved;
      }
   }

   return Motion;
});
