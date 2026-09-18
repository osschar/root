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
         this.font_size = 0.022;
         this.cursor_gap_px = 14;

         this.font_name = "LiberationSerif-Regular";

         this._font = null;      // {texture, metrics}, cached once delivered
         this._tip = null;       // the hover tooltip ZText
         this._pending = null;   // text asked for before the font arrived
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
            },
            (img) => this.RC.ZText.createDefaultTexture(img),
            () => this.viewer.request_render()
         );
      }

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
         this._tip.setupFrameStuff(1.0, true,
                                   new RC.Color(1.0, 1.0, 1.0), 0.85,
                                   this.viewer.fgCol, 1.0, 0.25, 0.06);
         this._tip.use_fg_color = true;
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

   return Annotations;
});
