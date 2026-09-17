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

         /** Cached once delivered. The box style rebuilds whenever the camera
          * crosses a face plane, which is far too often to re-request a font. */
         this._font = null;
         /** Which back faces and which labelled edges the current geometry was
          * built for; see _octantKey(). Null means "not built for any camera". */
         this._octant = null;
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
         this._octant = null;
         if (this.style === STYLE.NONE || !this.bbox) return;

         // Both the tick generator and the font arrive asynchronously. Chain
         // rather than nest: whichever is slower gates the build, and a second
         // rebuild while one is in flight is harmless because _build() starts
         // by clearing.
         this.ticks.init().then(() => {
            if (this._font) return this._build();
            this._withFont(f => { this._font = f; this._build(); });
         });
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

      _build() {
         this.clear();
         const font = this._font;
         if (this.style === STYLE.NONE || !this.bbox || !font) return;

         const RC = this.RC;
         const lines = [];    // flat [x0,y0,z0, x1,y1,z1] runs, one per segment
         const labels = [];   // for Z3DAxis

         if (this.style === STYLE.ORIGIN) {
            this._buildOrigin(lines, labels);
         } else {
            this._buildBox(lines, labels);
            // Record what this geometry was built for, so the camera check does
            // not immediately rebuild the very thing it just triggered.
            if (this.viewer.camera)
               this._octant = this._octantKey(this.viewer.camera);
         }

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

      //-----------------------------------------------------------------------
      // Box style (kAxesEdge)
      //-----------------------------------------------------------------------

      /** Camera position in world space, derived from the VIEW matrix.
       *
       * Deliberately not camera.matrixWorld: the viewer runs with
       * Object3D.sDefaultQuaternionsAndAutoUpdate off and manages matrices
       * itself, so a camera's matrixWorld is only as fresh as the last
       * updateMatrixWorld() that happened to reach it. matrixWorldInverse is
       * the VMat handed to every shader each frame, so it cannot be stale.
       *
       * For V = [R|t], the camera sits at -R^T t; with column-major elements
       * that is minus the dot of each of R's columns with t.
       *
       * Orthographic cameras have no eye point in the projective sense, but
       * theirs still lies on the view axis on the near side, which is all the
       * back-face test asks of it. */
      _camPos(camera) {
         const e = camera.matrixWorldInverse.elements;
         const tx = e[12], ty = e[13], tz = e[14];
         return [-(e[0]*tx + e[1]*ty + e[2] *tz),
                 -(e[4]*tx + e[5]*ty + e[6] *tz),
                 -(e[8]*tx + e[9]*ty + e[10]*tz)];
      }

      /** Which half of each axis the camera is on, as a 3-character key.
       *
       * For an axis-aligned box the visibility of a face is decided by one
       * comparison: the face further from the camera along that axis is the one
       * pointing away. So the whole back-face set -- and with it the panels, the
       * labelled edges and the tick directions -- changes only when the camera
       * crosses a face plane. That is what makes rebuilding on the key, rather
       * than every frame, correct and cheap. */
      _octantKey(camera) {
         const c = this._camPos(camera), b = this.bbox;
         const mid = [0.5 * (b.min.x + b.max.x),
                      0.5 * (b.min.y + b.max.y),
                      0.5 * (b.min.z + b.max.z)];
         let k = "";
         for (let a = 0; a < 3; ++a) k += (c[a] > mid[a]) ? "+" : "-";
         return k;
      }

      /** A box round the scene: the three faces pointing away from the camera,
       * ruled at the tick values, with numbers along three of the silhouette
       * edges.
       *
       * Only the far faces are drawn, so the panels are always behind the
       * geometry rather than in front of it. The set flips as the camera orbits;
       * that flip is what makes the box readable, not an artefact to suppress. */
      _buildBox(lines, labels) {
         const RC = this.RC;
         const b = this.bbox;
         const mn = [b.min.x, b.min.y, b.min.z];
         const mx = [b.max.x, b.max.y, b.max.z];
         const camera = this.viewer.camera;
         if (!camera) return;

         const diag = Math.hypot(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]);
         if (!(diag > 0)) return;

         const cam = this._camPos(camera);
         const mid = [0.5*(mn[0]+mx[0]), 0.5*(mn[1]+mx[1]), 0.5*(mn[2]+mx[2])];

         // back[a] is the coordinate of the face pointing away from the camera
         // along axis a; front[a] is the near one.
         const back = [], front = [];
         for (let a = 0; a < 3; ++a) {
            const camOnMaxSide = cam[a] > mid[a];
            back[a]  = camOnMaxSide ? mn[a] : mx[a];
            front[a] = camOnMaxSide ? mx[a] : mn[a];
         }

         const col  = new RC.Color(0.55, 0.55, 0.55);
         const gcol = new RC.Color(0.75, 0.75, 0.75);
         const at = (a, v, j, jv, k, kv) => {
            const p = [0, 0, 0];
            p[a] = v; p[j] = jv; p[k] = kv;
            return p;
         };

         const tick_sets = [];
         for (let a = 0; a < 3; ++a)
            tick_sets.push(this.ticks.ticks(mn[a], mx[a], this.n_ticks));

         // ---- the three back panels: border plus grid ------------------------
         // Grid lines come from the same tick array as the numbers, so a grid
         // line IS a tick extended across the panel. That alignment is the whole
         // point of the panels; a generic grid would not have it.
         for (let a = 0; a < 3; ++a) {
            const j = (a + 1) % 3, k = (a + 2) % 3;
            const v = back[a];

            // border
            const corners = [
               at(a, v, j, mn[j], k, mn[k]),
               at(a, v, j, mx[j], k, mn[k]),
               at(a, v, j, mx[j], k, mx[k]),
               at(a, v, j, mn[j], k, mx[k])
            ];
            for (let i = 0; i < 4; ++i)
               lines.push({ pts: [...corners[i], ...corners[(i+1)%4]],
                            width: 1.5, color: col });

            // grid, ruled in both in-plane directions
            for (const t of tick_sets[j].values) {
               if (t <= mn[j] || t >= mx[j]) continue;
               lines.push({ pts: [...at(a, v, j, t, k, mn[k]),
                                  ...at(a, v, j, t, k, mx[k])],
                            width: 1, color: gcol });
            }
            for (const t of tick_sets[k].values) {
               if (t <= mn[k] || t >= mx[k]) continue;
               lines.push({ pts: [...at(a, v, j, mn[j], k, t),
                                  ...at(a, v, j, mx[j], k, t)],
                            width: 1, color: gcol });
            }
         }

         // ---- numbers, on three silhouette edges -----------------------------
         // For each axis there are two candidate edges on the boundary of the
         // drawn panels: one back / one front in each of the other two axes.
         // Take whichever projects further from the box centre on screen, so the
         // numbers sit on the OUTSIDE of the silhouette rather than in the inner
         // crease where the panels meet -- there they would read as being inside
         // the scene, and geometry would cross them.
         const scr = (p) => {
            const v = new RC.Vector3(p[0], p[1], p[2]);
            v.project(camera);
            return [v.x, v.y];
         };
         const midScr = scr(mid);

         const tick_len = 0.018 * diag;
         const px = (this.viewer._px_to_screen || RC.ZText.PX_TO_SCREEN_SPACE);
         const gap = 5 * px;

         for (let a = 0; a < 3; ++a) {
            const j = (a + 1) % 3, k = (a + 2) % 3;

            // `out` is the axis the tick runs along. Each candidate edge sits
            // ON one back panel (the axis held at its back coordinate) and at
            // the far rim of it (the axis held at its front coordinate). The
            // tick therefore has to step along the FRONT one: that keeps it in
            // the plane of its own panel and takes it out past the silhouette.
            // Stepping along both would send it diagonally out of the corner,
            // in the plane of neither.
            const cands = [
               { jv: back[j],  kv: front[k], out: k },
               { jv: front[j], kv: back[k],  out: j }
            ];
            let best = null, bestD = -1;
            for (const c of cands) {
               const m = scr(at(a, 0.5*(mn[a]+mx[a]), j, c.jv, k, c.kv));
               const d = Math.hypot(m[0]-midScr[0], m[1]-midScr[1]);
               if (d > bestD) { bestD = d; best = c; }
            }

            const o = best.out;
            const ov = (o === j) ? best.jv : best.kv;
            const dir = (Math.sign(ov - mid[o]) || 1) * tick_len;
            // Offset a point on the edge outward along `out`.
            const step = (p, f) => { const q = p.slice(); q[o] += f * dir; return q; };

            const t = tick_sets[a];
            for (const val of t.values) {
               if (val < mn[a] || val > mx[a]) continue;

               const p0 = at(a, val, j, best.jv, k, best.kv);
               const p1 = step(p0, 1);
               lines.push({ pts: [...p0, ...p1], width: 1.2, color: col });

               labels.push({
                  text: t.format(val),
                  pos: p1,
                  px: 0, py: -gap,
                  ah: RC.ZText.ALIGN_H.CENTER,
                  av: RC.ZText.ALIGN_V.TOP
               });
            }

            // Axis name, past the far end of the labelled edge.
            const nm = ["x", "y", "z"][a];
            const e = step(at(a, mx[a], j, best.jv, k, best.kv), 2);
            labels.push({
               text: nm, pos: e, px: gap, py: gap,
               ah: RC.ZText.ALIGN_H.LEFT, av: RC.ZText.ALIGN_V.BOTTOM
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

         // The box is the only style whose geometry depends on where the camera
         // is, and it depends on it only through the octant -- so this rebuilds
         // when the camera crosses a face plane and not otherwise. Orbiting
         // within one octant costs the comparison above and nothing else.
         if (this.style === STYLE.BOX) {
            const k = this._octantKey(camera);
            if (k !== this._octant) {
               this._octant = k;
               this._build();
               return true;
            }
         }
         return false;
      }
   }

   Axis3D.STYLE = STYLE;
   return Axis3D;
});
