/** Axis3D -- axes for a real 3D scene.
 *
 * Deliberately a separate module rather than more methods on GlViewerRCore:
 * the viewer is already the biggest file in the client and an axis is a
 * self-contained piece of chrome. The viewer's whole share of this is to own
 * one Axis3D, tell it the bounding box, and call updateForCamera() from
 * render().
 *
 * How this differs from the projected (2D) axis, and why it is simpler:
 *
 * REveProjectionAxis has to live on the server because the projection is
 * non-linear and exists only there -- ticks are round numbers in *original*
 * space placed at their *projected* positions, which nothing on the client can
 * compute. A 3D axis has no such mapping. Its ticks are round numbers in world
 * space and depend on the bounding box alone, not on the camera, so the whole
 * thing is client-local: no element, no streaming, no round trip.
 *
 * What *is* camera-dependent is presentation -- which box faces point away from
 * the viewer, which edges carry the numbers, how dense the labels can be. That
 * is recomputed per frame in updateForCamera(), the direct analogue of
 * ZTextAxis.updateForCamera().
 *
 * The tick values still come from behind TickSource, even though nothing needs
 * that today: it is the seam a streamed tick set would arrive through if the
 * axis ever grows a server side (explicit ranges, per-axis titles, user ticks).
 */

sap.ui.define([], function() {

   "use strict";

   /** Round numbers for an axis range.
    *
    * d3's scale.ticks() is the 1/2/5 x 10^n picker, and it is what JSROOT's own
    * axes use -- TAxisPainter.produceTicks() calls this.func.ticks(). Using it
    * here means a REve 3D axis picks the same numbers a TAxis would, for free,
    * and there is no second nice-number implementation to keep honest.
    *
    * d3 is already in the module graph (draw.mjs, base3d.mjs, colors.mjs and
    * menu.mjs all pull it), so the import costs a resolved promise, not a fetch.
    */
   class TickSource {

      /** Resolves once the generator is usable. Everything that builds geometry
       * waits on this, the same way the font is waited on. */
      init() {
         if (this._ready) return this._ready;
         this._ready = import('jsrootsys/modules/d3.mjs').then(d3 => {
            this._scale = d3.scaleLinear;
            return this;
         });
         return this._ready;
      }

      /** Round values in [min, max], aiming for about n of them, plus a
       * formatter that prints them consistently -- d3 chooses the precision
       * from the step, so 0.1 does not come back as 0.1 next to 0.30000000004. */
      ticks(min, max, n) {
         if (!this._scale || !(max > min)) return { values: [], format: String };
         const s = this._scale().domain([min, max]);
         const v = s.ticks(n);
         const d3f = s.tickFormat(n);

         // d3 formats negatives with U+2212 MINUS SIGN, which is typographically
         // right and absent from every SDF atlas we generate -- the glyph lookup
         // falls back to "?", so -10 came out as "?10". Fold it to ASCII.
         const f = x => d3f(x).replace(/\u2212/g, '-');
         return { values: v, format: f };
      }
   }

   /** Axis style, matching REveViewer::EAxesType so the server enum can drive
    * this directly once it stops being collapsed to a bool on the way over. */
   const STYLE = { NONE: 0, ORIGIN: 1, BOX: 2 };

   class Axis3D {

      /** @param viewer a GlViewerRCore; used for RC, the texture cache, the
       * foreground colour and request_render. */
      constructor(viewer, RC) {
         this.viewer = viewer;
         this.RC = RC;

         this.group = new RC.Group();
         this.group.name = "Axis3D";

         this.style = STYLE.NONE;
         this.atten = RC.Z3DAxis.ATTEN_FIXED;

         /** Target number of labelled ticks per axis. Unlike the projected axis
          * this is not over-provided: there is no client-side filtering step to
          * feed, because a 3D tick's position is known exactly here. */
         this.n_ticks = 5;

         /** Tick length and label gap, as fractions of the bounding-box
          * diagonal. World-space, so ticks scale with the scene rather than
          * with the viewport -- see the note in Z3DAxis about what it would
          * take to make them a fixed number of pixels instead. */
         this.tick_frac = 0.02;

         /** Label size, as a fraction of viewport height -- the units ZText
          * uses in every screen-space mode. */
         this.font_size = 0.018;
         this.font_name = "LiberationSerif-Regular";

         this.ticks = new TickSource();
         this.bbox = null;
         this.labels_obj = null;
      }

      /** Origin, box, or nothing. */
      setStyle(style) {
         if (style === this.style) return;
         this.style = style;
         this.rebuild();
      }

      /** 0 = constant pixel size, 1 = shrinks exactly like geometry, in between
       * is the readable compromise. A uniform, so no rebuild. */
      setAttenuation(k) {
         this.atten = k;
         if (this.labels_obj) this.labels_obj.setAttenuation(k);
         this.viewer.request_render();
      }

      getAttenuation() { return this.atten; }

      /** The scene extent the axis describes. Rebuilds only on a real change:
       * recalcSceneBBox runs often and an identical box must not throw the
       * geometry away. */
      setBBox(bbox) {
         if (!bbox) return;
         const b = this.bbox;
         if (b && b.min.equals(bbox.min) && b.max.equals(bbox.max)) return;
         this.bbox = { min: bbox.min.clone(), max: bbox.max.clone() };
         this.rebuild();
      }

      clear() {
         this.group.clear();
         this.labels_obj = null;
      }

      rebuild() {
         this.clear();
         if (this.style === STYLE.NONE || !this.bbox) return;

         // Both the tick generator and the font arrive asynchronously. Chain
         // rather than nest: whichever is slower gates the build, and a second
         // rebuild while one is in flight is harmless because build() starts by
         // clearing.
         this.ticks.init().then(() => this._withFont(font => this._build(font)));
      }

      _withFont(cb) {
         // top_path, not eve_path: REveText registers the font directory with
         // gEve->AddLocation("sdf-fonts/", ...), i.e. at the server's top level.
         // The old makeAxis() asked under rootui5sys/eve7/ and so never got a
         // font at all, which is why its labels never appeared.
         const url_base = this.viewer.top_path + 'sdf-fonts/' + this.font_name;
         this.viewer.tex_cache.deliver_font(url_base,
            (texture, font_metrics) => { cb({ texture, metrics: font_metrics }); },
            (img) => this.RC.ZText.createDefaultTexture(img),
            () => this.viewer.request_render()
         );
      }

      _build(font) {
         this.clear();
         if (this.style === STYLE.NONE || !this.bbox) return;

         const RC = this.RC;
         const lines = [];    // flat [x0,y0,z0, x1,y1,z1] runs, one per segment
         const labels = [];   // for Z3DAxis

         if (this.style === STYLE.ORIGIN)
            this._buildOrigin(lines, labels);
         else
            console.warn("Axis3D: box style not implemented yet, drawing nothing");

         // ---- lines and ticks ------------------------------------------------
         // Stripes, not the label buffer: a 3D line of constant *pixel* width
         // needs the screen-space perpendicular, which is camera-dependent and
         // so cannot be baked into a static vertex buffer. Stripes computes it
         // in its vertex shader, which is exactly the job.
         for (const seg of lines) {
            const geom = new RC.Geometry();
            geom.vertices = new RC.Float32Attribute(new Float32Array(seg.pts), 3);
            const ss = this.viewer.creator.RcMakeStripes(geom, seg.width, seg.color);
            this.group.add(ss);
         }

         // ---- labels ---------------------------------------------------------
         // One object for every string on every axis: the anchor is per vertex,
         // so N labels are one draw call and no per-label matrix.
         if (labels.length) {
            const lo = new RC.Z3DAxis({
               text: "",
               fontTexture: font.texture,
               font: font.metrics,
               fontSize: this.font_size,
               fontHinting: 1.0,
               color: this.viewer.fgCol,
               atten: this.atten
            });
            lo.material.side = RC.FRONT_SIDE;
            // An axis is chrome and must stay legible when the background
            // flips. recolourFgElements() traverses the scene for exactly this
            // pair, so the axis needs no special case in the viewer.
            lo.use_fg_color = true;
            lo.setLabels(labels);
            this.labels_obj = lo;
            this.group.add(lo);
         }

         this.viewer.request_render();
      }

      /** Rays from the origin along each axis, ticked and labelled.
       *
       * Each axis runs to whichever of the box's faces it actually reaches --
       * and in both directions when the box spans the origin, since an axis
       * that stopped at zero would misreport a scene sitting on one side of it.
       */
      _buildOrigin(lines, labels) {
         const RC = this.RC;
         const b = this.bbox;
         const mn = [b.min.x, b.min.y, b.min.z];
         const mx = [b.max.x, b.max.y, b.max.z];

         const diag = Math.hypot(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]);
         const tick_len = this.tick_frac * diag;
         if (!(diag > 0)) return;

         const AX = [
            { i: 0, name: "x", col: new RC.Color(0.9, 0.3, 0.3) },
            { i: 1, name: "y", col: new RC.Color(0.3, 0.9, 0.3) },
            { i: 2, name: "z", col: new RC.Color(0.4, 0.5, 1.0) }
         ];

         // Label offset from the tick, in the shader's screen units -- a few
         // CSS pixels, converted the same way ZText converts its own.
         const px = (this.viewer._px_to_screen || RC.ZText.PX_TO_SCREEN_SPACE);
         const gap = 6 * px;

         const pt = (i, v) => { const p = [0, 0, 0]; p[i] = v; return p; };

         for (const ax of AX) {
            const i = ax.i;
            const lo = Math.min(0, mn[i]), hi = Math.max(0, mx[i]);
            if (!(hi > lo)) continue;

            // The axis line itself.
            lines.push({ pts: [...pt(i, lo), ...pt(i, hi)], width: 2, color: ax.col });

            const t = this.ticks.ticks(lo, hi, this.n_ticks);

            // Ticks go out along the next axis round the cycle: x ticks lie
            // along y, y along z, z along x. Any fixed choice is arbitrary, but
            // cycling keeps the three from all landing in one plane, where two
            // of them would overlap edge-on from the commonest viewpoints.
            const j = (i + 1) % 3;

            for (const v of t.values) {
               if (Math.abs(v) < 1e-12) continue;    // the origin needs no tick

               const p0 = pt(i, v);
               const p1 = pt(i, v); p1[j] += tick_len;
               lines.push({ pts: [...p0, ...p1], width: 1, color: ax.col });

               labels.push({
                  text: t.format(v),
                  pos: p1,
                  px: 0, py: -gap,
                  ah: RC.ZText.ALIGN_H.CENTER,
                  av: RC.ZText.ALIGN_V.TOP
               });
            }

            // The axis name, past the end of the line.
            labels.push({
               text: ax.name,
               pos: pt(i, hi),
               px: gap, py: gap,
               ah: RC.ZText.ALIGN_H.LEFT,
               av: RC.ZText.ALIGN_V.BOTTOM
            });
         }
      }

      /** Per-frame camera work.
       *
       * Today only the attenuation reference: the clip-space w of the box
       * centre, i.e. the distance at which a label is drawn at its nominal
       * size. Under an orthographic camera that w is 1 and attenuation
       * correctly collapses to a no-op.
       *
       * This is where back-face selection for the box style will go -- which
       * three faces point away from the camera, and which edges carry the
       * numbers. Both are pure functions of the view direction, so like the
       * projected axis's layout they stay client-local.
       */
      updateForCamera(camera) {
         if (!this.labels_obj || !this.bbox || !camera) return false;

         const RC = this.RC;
         const c = new RC.Vector3(0.5 * (this.bbox.min.x + this.bbox.max.x),
                                  0.5 * (this.bbox.min.y + this.bbox.max.y),
                                  0.5 * (this.bbox.min.z + this.bbox.max.z));

         // w of the centre under the current view-projection. A Vector4 applied
         // in two steps, as Vector3.project() does it -- the divide must not
         // happen behind our back, since w is the whole answer here.
         const v = new RC.Vector4(c.x, c.y, c.z, 1.0);
         v.applyMatrix4(camera.matrixWorldInverse);
         v.applyMatrix4(camera.projectionMatrix);
         this.labels_obj.setReferenceW(v.w);
         return false;
      }
   }

   Axis3D.STYLE = STYLE;
   return Axis3D;
});
