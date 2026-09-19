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
     * Only the translation is extrapolated. Rotation and scale are taken from
     * the last matrix the server sent and held, so a spinning object's spin
     * steps at the update rate while its flight is smooth. Angular velocity is
     * the obvious extension and is not done here.
     */
   class Motion {

      constructor(viewer) {
         this.viewer  = viewer;
         this.objects = new Map();   // element id -> entry
         this.offset  = null;        // performance.now() - server ms
         this.raf     = 0;
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
            // same message, before anything here has touched it.
            p0:     [m[12], m[13], m[14]],
            t0:     mot.t0,
            vel:    mot.vel,
            acc:    mot.acc,
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
         if (this.raf || this.objects.size === 0) return;
         this.raf = requestAnimationFrame(this.tick.bind(this));
      }

      stop() {
         if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
      }

      tick() {
         this.raf = 0;
         if (this.objects.size === 0) return;

         if (this.apply())
            this.viewer.request_render();

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

            if (m[12] !== x || m[13] !== y || m[14] !== z) {
               m[12] = x; m[13] = y; m[14] = z;
               e.obj3d.matrixChanged();
               moved = true;
            }
         }
         return moved;
      }
   }

   return Motion;
});
