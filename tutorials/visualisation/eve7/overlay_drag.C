/// \file
/// \ingroup tutorial_eve_7
/// Interactive overlay annotations: framed REveText boxes floating in front of
/// the 3D scene, which can be dragged and resized in the browser.
///
/// An *overlay* scene is a normal REveScene flagged with SetIsOverlay(true). Its
/// contents are rendered by a dedicated orthographic camera into a fixed screen
/// box, after and in front of the 3D scene, so annotations never disappear behind
/// geometry no matter how the camera is moved.
///
/// Coordinates in the overlay box are fractions of the viewport:
///
///     (0,0) = bottom-left corner,  (1,1) = top-right corner
///
/// Font size is given in the same units, i.e. as a fraction of viewport *height*;
/// the x direction is divided by the window aspect ratio so glyphs keep their
/// shape. That means a client with a differently shaped window sees the boxes at
/// the same relative position but covering a different fraction of its width --
/// worth remembering in a multi-client setup such as a control room.
///
/// Interaction, once REveText::SetPickable(true) is set:
///
/// The logo is the same kind of overlay element -- a screen-space image rather
/// than text -- and moves and resizes on exactly the same handling.
///
///     hover over a box             -> it lightens, and if it is resizable a small
///                                     square grip appears in its bottom corner
///     drag the box                 -> move it
///     drag the corner grip         -> resize it (font size and frame together)
///
/// SetPickable() governs moving, SetResizable() governs resizing, so a header can
/// be repositioned while keeping its size.
///
/// Both are **client-local**: they are handled entirely in the browser and
/// nothing is sent back to the server, so two people looking at the same scene
/// can arrange their annotations independently. Moving that state to the server,
/// so a layout can be shared or saved, would mean turning the two mutations into
/// MIRs on the element.
///
/// \macro_code
///
/// \author Matevz Tadel

#include <ROOT/REveElement.hxx>
#include <ROOT/REveGeoShape.hxx>
#include <ROOT/REveJetCone.hxx>
#include <ROOT/REveLogo.hxx>
#include <ROOT/REveManager.hxx>
#include <ROOT/REveScene.hxx>
#include <ROOT/REveText.hxx>
#include <ROOT/REveViewer.hxx>

#include "TColor.h"
#include "TGeoTube.h"
#include "TROOT.h"
#include "TMath.h"
#include "TRandom.h"

using namespace ROOT::Experimental;

/// Ships with ROOT in the data dir's fonts/ -- see texts.C.
static const char *kOvlFont = "LiberationSerif-Regular";

const Double_t kR_min = 240;
const Double_t kR_max = 250;
const Double_t kZ_d = 300;

//------------------------------------------------------------------------------

/// One framed annotation box. `x`, `y` and `size` are all fractions of the
/// viewport, per the coordinate note above.
REveText *makeAnnotation(REveElement *holder, const char *name, const char *text, float x, float y, float size,
                         Color_t text_color, Color_t frame_color, Color_t fill_color, bool resizable = true)
{
   auto t = new REveText(name);
   t->SetText(text);
   t->SetFont(kOvlFont);
   t->SetFontWeight(0.05f);   // stands in for the bold face ROOT does not ship
   t->SetMode(1); // 1 = screen mode: position is in the (0,1) overlay box
   t->SetFontSize(size);
   t->SetPosition(REveVector(x, y, 0.0));
   t->SetTextColor(text_color);

   // Frame: a filled, outlined plate behind the glyphs. Without it the text
   // floats on the scene and is hard to grab, since the whole plate -- not just
   // the glyph coverage -- is the pick target.
   t->SetDrawFrame(true);
   t->SetFillColor(fill_color);
   t->SetFillAlpha(170); // 0..255; translucent so the scene stays visible
   t->SetLineColor(frame_color);
   t->SetLineAlpha(255);
   t->SetLineWidth(0.06);   // in units of line height
   t->SetExtraBorder(0.25); // padding around the text, in font-size units

   // Required for drag and resize: without it the element is not in the picking
   // pass at all and mouse events pass straight through to the camera controls.
   t->SetPickable(true);
   // Movable either way; a non-resizable element keeps its size, which is what
   // you want for a fixed-format header. The corner grip is only drawn on
   // elements that can actually be resized, and only while hovered.
   t->SetResizable(resizable);

   holder->AddElement(t);
   return t;
}

/// A little 3D content to annotate, and to prove the overlay stays in front of it.
void makeSceneContent(REveManager *eveMng)
{
   auto b = new REveGeoShape("Barrel");
   b->SetShape(new TGeoTube(kR_min, kR_max, kZ_d));
   b->SetMainColor(kCyan);
   b->SetMainTransparency(60);
   b->SetNSegments(64);
   eveMng->GetGlobalScene()->AddElement(b);

   TRandom &r = *gRandom;
   auto jets = new REveElement("Jets");
   for (int i = 0; i < 4; ++i) {
      auto jet = new REveJetCone(Form("Jet_%d", i));
      jet->SetCylinder(2 * kR_max, 2 * kZ_d);
      jet->AddEllipticCone(r.Uniform(-2.5, 2.5), r.Uniform(0, TMath::TwoPi()), r.Uniform(0.05, 0.2),
                           r.Uniform(0.05, 0.25));
      jet->SetFillColor(kPink - 8);
      jet->SetLineColor(kBlack);
      jets->AddElement(jet);
   }
   eveMng->GetEventScene()->AddElement(jets);
}

//------------------------------------------------------------------------------

void overlay_drag()
{
   auto eveMng = REveManager::Create();

   // Allow several browsers to attach to the same session, so you can open the
   // printed URL in two windows and see that dragging an annotation in one does
   // not move it in the other -- the interaction is entirely client-side.
   //
   // NOTE: the second argument also switches off the single-use authentication
   // key, which is convenient while developing but should be reconsidered before
   // this is committed; see the security note in REveManager.
   eveMng->AllowMultipleRemoteConnections(false, false);

   // SDF fonts are generated on demand into ui5/eve7/sdf-fonts/ and reused after
   // that; this is a no-op once the .png and .js.gz for the font are present.
   // TROOT::GetDataDir()/fonts. ROOT ships no Liberation Sans and no bold
   // Liberation at all, so the weight comes from REveText::SetFontWeight() instead --
   // the SDF threshold gives synthetic bold from the one atlas, which is exactly the
   // case it exists for.
   std::string rf = std::string(TROOT::GetDataDir().Data()) + "/fonts/";
   REveText::AssertSdfFont(kOvlFont, rf + kOvlFont + ".ttf");

   makeSceneContent(eveMng);

   // An overlay scene is an ordinary scene, added to a viewer like any other and
   // then flagged as an overlay.
   REveScene *os = eveMng->SpawnNewScene("Overlay scene", "Draggable annotations");
   ((REveViewer *)(eveMng->GetViewers()->FirstChild()))->AddScene(os);
   os->SetIsOverlay(true);

   // Images have to be reachable by the browser, so the directory holding them
   // is registered as an HTTP location. Any readable directory works: an
   // experiment would point this at its own icons -- for CMS, at
   //   .../src/Fireworks/Core/icons
   // Here we use the icons that ship with ROOT, so the tutorial runs anywhere:
   // icons/ is both copied into the build tree and installed, and
   // TROOT::GetIconPath() resolves it in either case -- unlike ${ROOTSYS}/icons,
   // which does not survive a gnuinstall-style layout.
   //
   // Two other sources exist: REveLogo::kTextures for the ZSprite template
   // textures in ui5/eve7/textures, and an absolute URL, which the browser
   // fetches directly -- convenient, but subject to CORS, mixed content and
   // certificate checks, so not something to rely on. See REveLogo::SetFile.
   REveLogo::SetImageDir(TROOT::GetIconPath().Data());

   auto logo = new REveLogo("Root6Icon.png", "Logo");
   logo->SetPosition(0.88, 0.86);   // (0,1) overlay box; the image is centred here
   logo->SetSize(110);              // height in CSS pixels; width follows the image
   logo->SetOpacity(0.75);          // a watermark: it brightens when hovered
   os->AddElement(logo);

   auto holder = new REveElement("annotations");

   // Arctic ambient: cool, low-saturation, with the one saturated blue reserved
   // to mean "this element is interactive". Annotations sit on top of the event,
   // so they should stay legible without competing with it for attention.
   const Color_t kInk   = TColor::GetColor("#1f2d36"); // deep slate text
   const Color_t kIce   = TColor::GetColor("#f2f7f9"); // plate, a cool white
   const Color_t kQuiet = TColor::GetColor("#8fa6b2"); // frame, static label
   const Color_t kLive  = TColor::GetColor("#3f7d96"); // frame, interactive

   makeAnnotation(holder, "Title", "Run 123456 / Event 42", 0.03, 0.95, 0.035, kInk, kQuiet, kIce, false);
   makeAnnotation(holder, "DragMe", "drag me anywhere", 0.03, 0.85, 0.030, kInk, kLive, kIce);
   makeAnnotation(holder, "ResizeMe", "hover me, then grab the corner", 0.03, 0.76, 0.030, kInk, kLive, kIce);

   // Multi-line: embed newlines in the text. The box grows downwards, one
   // line_height per line. Note the resize grip does NOT grow with it -- it is
   // scaled on a single line, because a taller note has no bigger text and so
   // needs no bigger handle.
   makeAnnotation(holder, "Legend", "legend\n  cyan  barrel\n  pink  jet cones", 0.03, 0.67, 0.030, kInk, kLive,
                  kIce);

   makeAnnotation(holder, "InFront", "always in front of the geometry", 0.34, 0.28, 0.026, kInk, kQuiet, kIce, false);

   os->AddElement(holder);

   eveMng->Show();
}
