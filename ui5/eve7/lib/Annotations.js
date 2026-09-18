/** Annotations -- the hover tooltip, and (later) annotations kept from it.
 *
 * A separate module for the same reason Axis3D is one: GlViewerRCore is already
 * the biggest file in the client, and this is self-contained. The viewer's whole
 * share is to own one Annotations, tell it what is hovered, and let it draw.
 *
 * Why the tooltip stops being a DOM div
 * -------------------------------------
 * It was a `div.eve_tooltip` appended next to the canvas and positioned in CSS
 * pixels. That works, but it is a second, parallel way of putting marks on the
 * viewer -- it cannot be moved or resized by the overlay machinery that every
 * other floating element already uses, it does not follow the viewer's
 * foreground colour, and, decisively, **it is not in the framebuffer**, so it is
 * absent from every screen capture. A ZText in the overlay scene is in the
 * capture automatically: RendeQuTor blends the overlay into tex_final before
 * render_tone_map_to_capture() reads it.
 *
 * Plain text only, which is what the tooltips already are -- all three
 * getTooltipText() implementations return fTitle/fName or composed numbers, no
 * markup, so nothing is lost in the move. Newlines and spaces are preserved by
 * ZText. Rich text would be a different job and does not belong in GL.
 */

sap.ui.define([], function() {

   "use strict";

   class Annotations {

      /** @param viewer a GlViewerRCore; used for the overlay scene, the texture
       * cache, the foreground colour and request_render. */
      constructor(viewer, RC) {
         this.viewer = viewer;
         this.RC = RC;

         /** Size and placement of the hover tooltip. font_size is a fraction of
          * viewport height, as everywhere in ZText's screen modes; the gap is in
          * CSS pixels and keeps the box clear of the cursor itself. */
         this.font_size = 0.017;
         this.cursor_gap_px = 14;

         this.font_name = "LiberationSerif-Regular";

         /** Button size, as a fraction of the annotation's own font size, and
          * the gap between the box and its buttons in screen fractions. */
         this.btn_scale = 0.8;

         /** How far outside the annotation the pointer still counts as "on"
          * it. The buttons now share frames with the plate, so there is no gap
          * to cross -- this is only slack against the pointer sitting exactly
          * on an outer edge. */
         this.hover_margin = 0.008;

         /** Frame line width, as a fraction of the line height. ZText's own
          * default of 0.06 is sub-pixel at these font sizes and rasterises away
          * edge by edge, so a box loses its top rule first and reads as broken
          * rather than as small. */
         this.frame_line = 0.14;

         /** Plate opacity, streamed from REveViewer::fTooltipAlpha. */
         this.plate_alpha = 0.85;

         this._font = null;      // {texture, metrics}, cached once delivered
         this._tip = null;       // the hover tooltip ZText
         this._pending = null;   // text asked for before the font arrived
         this._kept = [];        // Annotation instances
      }

      //-----------------------------------------------------------------------
      // Kept annotations
      //-----------------------------------------------------------------------

      /** Is there something to keep? The context menu asks before offering. */
      canKeep() { return !!(this._tip && this._tip.visible && this._tip.text); }

      /** Turn the current hover tooltip into a kept annotation: a copy of it
       * that stays put, can be moved and resized, and carries its own buttons.
       *
       * A copy rather than a handover -- the tooltip goes on being the tooltip.
       * Keeping twice in a row should give two annotations, not move one. */
      keepCurrent() {
         if (!this.canKeep()) return null;
         const a = new Annotation(this, this._tip.text, this._tip.ovlGetPos(),
                                  this._tip.fontSize);
         this._kept.push(a);
         this.hideTooltip();
         this.viewer.request_render();
         return a;
      }

      /** Keep an annotation with given text at a canvas position, independent of
       * whether a tooltip is showing. This is the context-menu path: by the time
       * the menu is up the tooltip has been hidden by pointerleave, so the menu
       * supplies its own text from its own pick. */
      keepAt(text, x, y) {
         if (!text) return null;
         if (!this._font) {
            // Font not in yet -- ask for it and place the annotation when it
            // lands, rather than dropping the request on the floor.
            this._ensureFont();
            this._keep_pending = { text: text, x: x, y: y };
            return null;
         }
         return this._keepAtNow(text, x, y);
      }

      _keepAtNow(text, x, y) {
         const W = this.viewer.canvas.width, H = this.viewer.canvas.height;
         const px = (this.viewer.canvas.pixelRatio || 1);
         const pos = [(x * px) / W, 1.0 - (y * px) / H];
         const a = new Annotation(this, text, pos, this.font_size);
         this._kept.push(a);
         this.viewer.request_render();
         return a;
      }

      _forget(a) {
         const i = this._kept.indexOf(a);
         if (i >= 0) this._kept.splice(i, 1);
         this.viewer.request_render();
      }

      /** Buttons sit on the box, so they have to be re-placed whenever it moves
       * or resizes. Called from the viewer's render loop: a drag moves the box
       * through ovlSetPos without telling anyone, so there is nothing to hook. */
      layout() {
         // Buttons show only while the pointer is on the annotation -- "when
         // the tile is entered". The test is over the whole GROUP, not the box
         // alone: moving onto a button leaves the box, and if that hid the
         // buttons they could never be clicked.
         const dragged = this.viewer.ovl_drag ? this.viewer.ovl_drag.obj : null;
         const nx = this.viewer.ovl_nx, ny = this.viewer.ovl_ny;
         for (const a of this._kept) {
            // Geometry first: the test below is against the laid-out rects.
            a.layout();
            a.setButtonsVisible(a.owns(dragged) || a.containsPointer(nx, ny));
         }
      }

      //-----------------------------------------------------------------------
      // The hover tooltip
      //-----------------------------------------------------------------------

      /** Show `text` with its top-left corner near (x, y), in CSS pixels from
       * the top-left of the canvas. */
      showTooltip(text, x, y) {
         if (!text) return this.hideTooltip();

         if (!this._tip) {
            // First call: the font is fetched once and cached. Remember what was
            // asked for, so the tooltip appears as soon as the font lands rather
            // than only on the next hover.
            this._pending = { text: text, x: x, y: y };
            this._ensureFont();
            return;
         }
         this._apply(text, x, y);
      }

      /** Tooltip label size, as a fraction of viewport height. Streamed from
       * REveViewer::fTooltipFontSize, so every client of the viewer agrees and
       * it survives a reload -- the same arrangement as the axis font size.
       * Kept annotations keep the size they were made at: a size change should
       * not reach back and rewrite annotations already placed. */
      setFontSize(sz) {
         if (!(sz > 0) || sz === this.font_size) return;
         this.font_size = sz;
         if (this._tip) {
            this._tip.fontSize = sz;
            this.viewer.request_render();
         }
      }

      getFontSize() { return this.font_size; }

      hideTooltip() {
         this._pending = null;
         if (this._tip && this._tip.visible) {
            this._tip.visible = false;
            this.viewer.request_render();
         }
      }

      // No recolour() here: the tooltip carries use_fg_color, and the viewer's
      // recolourFgElements() already traverses overlay_scene looking for exactly
      // that flag. One mechanism, not two.

      //-----------------------------------------------------------------------

      _ensureFont() {
         if (this._font_requested) return;
         this._font_requested = true;

         // top_path, not eve_path: REveText registers the atlas directory with
         // gEve->AddLocation("sdf-fonts/", ...), at the server's top level.
         const url_base = this.viewer.top_path + 'sdf-fonts/' + this.font_name;
         this.viewer.tex_cache.deliver_font(url_base,
            (texture, font_metrics) => {
               this._font = { texture: texture, metrics: font_metrics };
               this._build();
               if (this._pending) {
                  const p = this._pending;
                  this._pending = null;
                  this._apply(p.text, p.x, p.y);
               }
               if (this._keep_pending) {
                  const k = this._keep_pending;
                  this._keep_pending = null;
                  this._keepAtNow(k.text, k.x, k.y);
               }
            },
            (img) => this.RC.ZText.createDefaultTexture(img),
            () => this.viewer.request_render()
         );
      }

      /** ZText floors its frame line and resize grip at a number of CSS pixels,
       * which it can only do if it knows how big a CSS pixel is. The viewer
       * sets that by traversing the overlay scene -- but only when the factor
       * CHANGES, so an object added afterwards keeps the 1/900 class default
       * for ever. Everything created here is created afterwards. */
      _fixPixelScale(obj) {
         const v = this.viewer;
         if (typeof obj.setPixelScale !== "function") return;
         if (!(v._px_to_screen > 0)) return;
         obj.setPixelScale(v._px_to_screen, v.canvas.width, v.canvas.height);
      }

      /** @param line_frac frame width as a fraction of the object's OWN line
       * height. Defaults to the plate's value; a button passes a bigger
       * fraction so that its absolute frame comes out the same -- see
       * Annotation._frameFrac(). */
      _plate(obj, line_frac) {
         const RC = this.RC;
         obj.setupFrameStuff(1.0, true,
                             new RC.Color(1.0, 1.0, 1.0), this.plate_alpha,
                             this.viewer.fgCol, 1.0, 0.25,
                             (line_frac === undefined) ? this.frame_line : line_frac);
         obj.use_fg_color = true;
         this._fixPixelScale(obj);
      }

      /** Plate opacity, applied live to the tooltip and to every kept
       * annotation.
       *
       * Both fill_alpha AND _norm_fill_alpha have to be set. ZText's highlight
       * bumps fill_alpha by 0.30 and restores it from _norm_fill_alpha when the
       * highlight goes -- so writing only fill_alpha survives exactly until the
       * next time the pointer crosses the element, and then silently reverts. */
      setPlateAlpha(a) {
         if (!(a >= 0) || a === this.plate_alpha) return;
         this.plate_alpha = a;

         const put = (o) => {
            if (!o) return;
            o.fill_alpha = a;
            o._norm_fill_alpha = a;
         };
         put(this._tip);
         for (const an of this._kept) {
            put(an.text_obj); put(an.btn_close); put(an.btn_edit);
         }
         this.viewer.request_render();
      }

      getPlateAlpha() { return this.plate_alpha; }

      _build() {
         const RC = this.RC;

         this._tip = new RC.ZText({
            text: " ",
            fontTexture: this._font.texture,
            font: this._font.metrics,
            fontSize: this.font_size,
            mode: RC.TEXT2D_SPACE_SCREEN,
            fontHinting: 1.0,
            color: this.viewer.fgCol,
            alignH: RC.ZText.ALIGN_H.LEFT,
            alignV: RC.ZText.ALIGN_V.TOP
         });

         // A hover tooltip is passive: it must not be draggable, resizable or
         // hoverable itself, or it would fight the very hover that produced it.
         // Those become true when an annotation is KEPT, which is what
         // ZText's ovlGetPos/ovlSetPos/ovlGetSize interface is already for.
         this._tip.pickable  = false;
         this._tip.resizable = false;

         // A plate behind the text, so it stays readable over busy geometry --
         // the one thing the DOM tooltip got for free from CSS.
         this._plate(this._tip);
         this._tip.visible = false;

         this.viewer.overlay_scene.add(this._tip);
      }

      _apply(text, x, y) {
         const RC = this.RC;
         const t = this._tip;
         if (t.text !== text) t.text = text;

         const W = this.viewer.canvas.width, H = this.viewer.canvas.height;
         if (!(W > 0 && H > 0)) return;

         this._last = { text: text, x: x, y: y };

         const px  = (this.viewer.canvas.pixelRatio || 1);
         const gap = this.cursor_gap_px * px;
         const sx  = x * px, sy = y * px;

         // Flip the box to the other side of the cursor near an edge, so it
         // cannot run off the canvas. The DOM tooltip did this by switching
         // between left/right and top/bottom CSS anchors; here the same choice
         // is the text's own alignment, which is cheaper and exact -- ZText
         // aligns against its real laid-out box, where the CSS version was
         // guessing before the box existed.
         const right_half = sx > 0.5 * W;
         const lower_half = sy > 0.5 * H;

         t.setAlign(right_half ? RC.ZText.ALIGN_H.RIGHT : RC.ZText.ALIGN_H.LEFT,
                    lower_half ? RC.ZText.ALIGN_V.BOTTOM : RC.ZText.ALIGN_V.TOP);

         // ZText's screen mode measures from the BOTTOM-left in (0,1); the
         // pointer arrives top-left in CSS pixels.
         const ox = (sx + (right_half ? -gap : gap)) / W;
         const oy = 1.0 - (sy + (lower_half ? -gap : gap)) / H;
         t.setOffset([ox, oy]);

         t.visible = true;
         this.viewer.request_render();
      }

      /** Re-show the last tooltip with new text, at the position it already
       * had. This is the server-driven path (REveManager can push a tooltip
       * string for the highlighted element after the fact), which has no
       * pointer position of its own. */
      updateText(text) {
         if (!this._last) return;
         this.showTooltip(text, this._last.x, this._last.y);
      }
   }

   /** One kept annotation: the text box plus its X and E buttons.
    *
    * All three are ordinary overlay ZTexts, so they get picking, dragging,
    * resizing and hover highlight from the machinery that already exists. The
    * only thing added is a local click handler -- `_ovl_click` -- because
    * GlViewerRCore.overlayClick() otherwise only knows how to send a server MIR,
    * and these buttons act entirely on the client.
    */
   class Annotation {

      constructor(owner, text, pos, font_size) {
         this.owner = owner;
         const RC = owner.RC, f = owner._font;

         this.text_obj = new RC.ZText({
            text: text,
            fontTexture: f.texture, font: f.metrics,
            fontSize: font_size,
            mode: RC.TEXT2D_SPACE_SCREEN,
            fontHinting: 1.0,
            color: owner.viewer.fgCol,
            alignH: RC.ZText.ALIGN_H.LEFT,
            alignV: RC.ZText.ALIGN_V.TOP
         });
         this.text_obj.setOffset(pos.slice());
         // Movable AND resizable: this is the point of keeping it.
         this.text_obj.pickable  = true;
         this.text_obj.resizable = true;
         owner._plate(this.text_obj);
         this.text_obj._ovl_click = () => {};   // a click on the body does nothing

         this.btn_close = this._makeButton("X", () => this.remove());
         this.btn_edit  = this._makeButton("E", () => this.edit());

         // Hidden until the pointer enters the annotation; layout() decides.
         this.btn_close.visible = false;
         this.btn_edit.visible  = false;
         this._btns_on = false;

         const os = owner.viewer.overlay_scene;
         os.add(this.text_obj);
         os.add(this.btn_close);
         os.add(this.btn_edit);

         this.layout();
      }

      _makeButton(label, onclick) {
         const RC = this.owner.RC, f = this.owner._font;
         const b = new RC.ZText({
            text: label,
            fontTexture: f.texture, font: f.metrics,
            fontSize: this.text_obj.fontSize * this.owner.btn_scale,
            mode: RC.TEXT2D_SPACE_SCREEN,
            fontHinting: 1.0,
            color: this.owner.viewer.fgCol,
            alignH: RC.ZText.ALIGN_H.LEFT,
            alignV: RC.ZText.ALIGN_V.BOTTOM
         });
         b.pickable  = true;
         // Not resizable: a button with a resize grip would hand over half its
         // own hit area to the grip, and there is nothing to resize.
         b.resizable = false;
         this.owner._plate(b, this.owner.frame_line / this.owner.btn_scale);
         b._ovl_click = onclick;
         return b;
      }

      /** Place the buttons above the box's top-right corner.
       *
       * Above rather than inside: inside would cover text, and the bottom-right
       * corner is already the resize grip's. Recomputed from the box's actual
       * laid-out rect, so it follows both a move and a resize without either
       * having to report itself. */
      layout() {
         const v = this.owner.viewer;
         if (!v.canvas || !v.canvas.width) return;
         const aspect = v.canvas.width / v.canvas.height;
         const r = this.text_obj.getScreenRect(aspect);
         if (!r) return;

         // Buttons track the plate's size. Resizing the annotation has to carry
         // its furniture with it -- text, frame and buttons are one object as
         // far as anyone using it is concerned. Guarded, because assigning
         // fontSize rebuilds glyph geometry and this runs every frame.
         const want = this.text_obj.fontSize * this.owner.btn_scale;
         if (Math.abs(this.btn_close.fontSize - want) > 1e-9) {
            this.btn_close.fontSize = want;
            this.btn_edit.fontSize  = want;
            // The frame fraction is relative to each object's OWN line height,
            // so a smaller button needs a bigger fraction to draw the same
            // absolute width. Without this the three frames differ and nothing
            // below can make them line up.
            this.owner._plate(this.btn_close, this._frameFrac());
            this.owner._plate(this.btn_edit,  this._frameFrac());
         }

         // Frames SHARE pixels rather than stacking:
         //   - X's left frame continues the plate's left frame;
         //   - the buttons' bottom frames land exactly on the plate's top
         //     frame;
         //   - E's left frame IS X's right frame, so there is no double rule
         //     between them.
         //
         // All of this is in OUTER edges, and getScreenRect does NOT give those.
         // It reads the first quad of the geometry, and setText2D writes the
         // inner fill first -- fill_rect(verts, 0, l+frame, r-frame, ...) -- so
         // the rect it returns is inset by one frame width on every side.
         // Working in it directly put every edge out by a frame, which showed up
         // as four vertical rules between X and E instead of three.
         const P = this._outer(this.text_obj, aspect);
         if (!P) return;
         const wf  = this._frameWidthOf(this.text_obj);   // == screen y units
         const wfx = wf / aspect;                         // x is aspect-divided

         // Measure, then correct. The offset means different things for
         // different alignH/alignV; a measured rect does not.
         const place = (obj, out_l, out_b) => {
            const o = this._outer(obj, aspect);
            if (!o) return null;
            const p = obj.ovlGetPos();
            obj.setOffset([p[0] + (out_l - o.l), p[1] + (out_b - o.b)]);
            return this._outer(obj, aspect);
         };

         // The plate's top frame bar spans [P.t - wf, P.t]; a button's bottom
         // bar spans [out_b, out_b + wf]. Coincident means out_b = P.t - wf.
         const bottom = P.t - wf;
         const oc = place(this.btn_close, P.l, bottom);
         if (oc) place(this.btn_edit, oc.r - wfx, bottom);
      }

      /** Is `o` one of this annotation's three objects? */
      owns(o) {
         return !!o && (o === this.text_obj || o === this.btn_close || o === this.btn_edit);
      }

      /** Frame width as a fraction of a BUTTON's line height, chosen so the
       * absolute width matches the plate's. The frame is line_width *
       * line_height and line_height scales with the font, so a button at
       * btn_scale of the plate's size needs the fraction divided by it. */
      _frameFrac() { return this.owner.frame_line / this.owner.btn_scale; }

      /** An object's frame width, in ZText geometry units -- screen fractions
       * in y, aspect-divided in x. Mirrors setText2D: line_width * line_height,
       * floored at MIN_FRAME_LINE_PX. Per object, not per annotation: the floor
       * can bite on a small button while leaving the plate alone, and then the
       * two frames genuinely differ. */
      _frameWidthOf(obj) {
         const RC = this.owner.RC;
         const f = this.owner._font;
         if (!f) return 0;
         const fm = RC.ZText._fontMetrics(f.metrics, obj.fontSize, 0.0);
         const w  = obj.line_width * fm.line_height;
         return Math.max(w, RC.ZText.MIN_FRAME_LINE_PX * obj._pxToScreen);
      }

      /** Outer edges of an object's box: what getScreenRect reports, grown by
       * one frame width, since that rect is the inner fill. */
      _outer(obj, aspect) {
         const r = obj.getScreenRect(aspect);
         if (!r) return null;
         const wf = this._frameWidthOf(obj), wfx = wf / aspect;
         return { l: Math.min(r.x0, r.x1) - wfx, r: Math.max(r.x0, r.x1) + wfx,
                  b: Math.min(r.y0, r.y1) - wf,  t: Math.max(r.y0, r.y1) + wf };
      }

      /** Is the pointer on this annotation, counting its buttons and the gap
       * between them as part of it? Union of the three rects plus a margin --
       * a plain "is ovl_hover one of mine" test fails in the gap, which is
       * exactly where the pointer is while travelling towards a button. */
      containsPointer(nx, ny) {
         if (!(nx >= -1) || !(ny >= -1)) return false;   // no pointer seen yet
         const v = this.owner.viewer;
         if (!v.canvas || !v.canvas.width) return false;
         const aspect = v.canvas.width / v.canvas.height;
         const m = this.owner.hover_margin;

         let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
         for (const o of [this.text_obj, this.btn_close, this.btn_edit]) {
            const r = this._outer(o, aspect);
            if (!r) continue;
            x0 = Math.min(x0, r.l); x1 = Math.max(x1, r.r);
            y0 = Math.min(y0, r.b); y1 = Math.max(y1, r.t);
         }
         if (!(x1 > x0)) return false;
         return nx >= x0 - m && nx <= x1 + m && ny >= y0 - m && ny <= y1 + m;
      }

      setButtonsVisible(on) {
         if (this._btns_on === on) return;
         this._btns_on = on;
         this.btn_close.visible = on;
         this.btn_edit.visible  = on;
         this.owner.viewer.request_render();
      }

      setText(t) {
         this.text_obj.text = t;
         this.layout();
         this.owner.viewer.request_render();
      }

      remove() {
         const os = this.owner.viewer.overlay_scene;
         os.remove(this.text_obj);
         os.remove(this.btn_close);
         os.remove(this.btn_edit);
         this.owner._forget(this);
      }

      /** Edit the text in an HTML textarea floating over the canvas.
       *
       * HTML because text entry is a DOM problem -- caret, selection, IME,
       * clipboard -- and none of that belongs in GL. The textarea only produces
       * a string; what renders it is still ZText, still plain text. When these
       * become real REveElements the editor should move to the side panel,
       * which is the same split, better placed.
       */
      edit() {
         if (this._editor) return;
         const v = this.owner.viewer;
         const dom = v.canvas.parentDOM;
         if (!dom) return;

         const ta = document.createElement('textarea');
         ta.value = this.text_obj.text;
         ta.style.position = "absolute";
         ta.style.zIndex = 1000;
         ta.style.font = "13px monospace";
         ta.style.minWidth = "220px";
         ta.style.minHeight = "70px";

         // Over the annotation itself: the thing being edited should not be
         // somewhere else on the screen while it is edited.
         const aspect = v.canvas.width / v.canvas.height;
         const r = this.text_obj.getScreenRect(aspect);
         const px = (v.canvas.pixelRatio || 1);
         if (r) {
            ta.style.left = (Math.min(r.x0, r.x1) * v.canvas.width / px) + "px";
            ta.style.top  = ((1 - Math.max(r.y0, r.y1)) * v.canvas.height / px) + "px";
         }

         const close = (apply) => {
            if (apply) this.setText(ta.value);
            ta.remove();
            this._editor = null;
         };
         ta.addEventListener('keydown', (e) => {
            // Esc abandons; Ctrl/Cmd-Enter applies. Plain Enter must stay a
            // newline -- these strings are multi-line by nature.
            if (e.key === "Escape") { e.stopPropagation(); close(false); }
            else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
               e.stopPropagation(); close(true);
            }
         });
         ta.addEventListener('blur', () => close(true));

         dom.appendChild(ta);
         this._editor = ta;
         ta.focus();
         ta.select();
      }
   }

   return Annotations;
});
