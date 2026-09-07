/// \file
/// \ingroup tutorial_eve_7
/// Deterministic SDF-text test grid for REveText.
///
/// Unlike texts.C, which scatters random words at random sizes and fonts, this
/// macro lays text out on a fixed grid, so two runs can be compared
/// pixel-by-pixel. It is meant for judging *text quality*: every axis known to
/// affect SDF rendering is varied on its own, one panel per scene.
///
///   A  SCREEN mode, font-size ladder   The SDF antialiasing width is derived
///                                      from the font size; this sweeps it over
///                                      the full useful range.
///   B  SCREEN mode, font comparison    One line per generated SDF font, same size.
///   C  WORLD mode, size ladder         The same sweep, in world units.
///   D  WORLD mode, rotation fan        Anisotropy: is the AA width still right
///                                      when the quad is seen at an angle?
///   E  MIXED mode, depth ladder        World position, screen size, front facing:
///                                      all five must render at *identical* size.
///
/// Two viewers watch the same scenes, one perspective and one orthographic. That
/// is the multi-view demo -- several clients may watch one scene through
/// different views -- and also a test, since the AA width is computed from a
/// clip-space probe and so need not agree between the two projections.
///
/// The screen-mode ladder straddles cap_height, ~0.033 of viewport height for the
/// Liberation atlases; that is the one size at which the current AA-width
/// expression comes out exact.
///
/// Panels can be isolated from the ROOT prompt while the macro runs:
///     tg_only("C")     // show panel C alone
///     tg_only("")      // show all panels again
///
/// \macro_code
///
/// \author Matevz Tadel

#include <ROOT/REveElement.hxx>
#include <ROOT/REveManager.hxx>
#include <ROOT/REveBox.hxx>
#include <ROOT/REveScene.hxx>
#include <ROOT/REveText.hxx>
#include <ROOT/REveViewer.hxx>

#include "TROOT.h"
#include "TMath.h"

#include <map>
#include <string>

namespace REX = ROOT::Experimental;
using namespace ROOT::Experimental;

// Short on purpose: at the top of the size ladder a long string runs off the
// viewport. Chosen to expose the usual SDF failure modes --
//   Ill1  vertical stems a pixel apart      OQ08  round counters
//   //\\  diagonals, the worst case for AA  ..    dots that vanish when the
//                                                 smoothstep is too wide
const char *kRuler = "Ill1 OQ08 //\\\\ ..";

// Every one of these ships in ROOT's data dir. ROOT carries Liberation Mono and Serif
// but no Liberation Sans, so a Sans entry would only work where the distribution
// happens to provide it. Bold is demonstrated with REveText::SetFontWeight() rather
// than a second atlas -- see panel B.
const char *kFonts[] = {"LiberationSerif-Regular", "LiberationMono-Regular", "verdana",
                        "georgia",                 "comic",                  "comicbd",
                        "BlackChancery"};
const int kNFonts = sizeof(kFonts) / sizeof(char *);

// Geometric ladder straddling cap_height (0.033 in viewport-height units).
const float kSizes[] = {0.005f, 0.008f, 0.012f, 0.018f, 0.024f, 0.033f, 0.045f, 0.060f};
const int kNSizes = sizeof(kSizes) / sizeof(float);

const double kWorldLim = 100.0; // half-extent of the world-mode panels

std::map<std::string, REveElement *> gPanels;

//------------------------------------------------------------------------------

static REveText *MakeText(REveElement *holder, const char *name, const std::string &txt, const char *font, int mode,
                          float size, Color_t col)
{
   auto t = new REveText(name);
   t->SetText(txt);
   t->SetFont(font);
   t->SetMode(mode);
   t->SetFontSize(size);
   t->SetTextColor(col);
   t->SetDrawFrame(false); // frames would dominate the picture at small sizes
   holder->AddElement(t);
   return t;
}

// REveText::ComputeBBox() is empty, so text alone contributes nothing to the
// scene extent and the client -- which fits the camera with Box3.setFromObject()
// over the RenderCore scene graph -- has nothing to frame on. Give the
// world-mode scenes a piece of real geometry with a known extent.
static void AddBBoxAnchor(REveElement *holder, double lim)
{
   auto b = new REveBox("bbox_anchor");
   const double v[8][3] = {{-1,-1,-1},{-1,1,-1},{1,1,-1},{1,-1,-1},
                           {-1,-1, 1},{-1,1, 1},{1,1, 1},{1,-1, 1}};
   for (int i = 0; i < 8; ++i)
      b->SetVertex(i, lim*v[i][0], lim*v[i][1], lim*v[i][2]);
   b->SetMainColor(kGray);
   b->SetMainTransparency(90);
   holder->AddElement(b);
}

// A -- SCREEN mode, font-size ladder, upper part of the left column.
static void PanelA(REveElement *h)
{
   float y = 0.97;
   for (int i = 0; i < kNSizes; ++i) {
      float s = kSizes[i];
      auto t = MakeText(h, Form("A_%02d_size_%.3f", i, s), Form("%.3f %s", s, kRuler), "LiberationSans-Regular", 1, s,
                        kBlack);
      t->SetPosition(REveVector(0.01, y, 0.0));
      y -= 2.2 * s + 0.012;
   }
}

// B -- SCREEN mode, one line per font, same size, below panel A.
static void PanelB(REveElement *h)
{
   float y = 0.40;
   for (int i = 0; i < kNFonts; ++i) {
      auto t = MakeText(h, Form("B_%02d_%s", i, kFonts[i]), Form("%s %s", kRuler, kFonts[i]), kFonts[i], 1, 0.018f,
                        kBlue + 2);
      t->SetPosition(REveVector(0.01, y, 0.0));
      y -= 0.048;
   }
}

// C -- WORLD mode, size ladder, stacked in y, all facing +z.
static void PanelC(REveElement *h)
{
   AddBBoxAnchor(h, kWorldLim);
   float y = -kWorldLim + 10.0;
   for (int i = 0; i < kNSizes; ++i) {
      float s = 200.0 * kSizes[i]; // world units: 1.0 .. 12.0
      auto t = MakeText(h, Form("C_%02d_size_%.1f", i, s), Form("%.1f %s", s, kRuler), "LiberationSans-Regular", 0, s,
                        kRed + 2);
      t->RefMainTrans().SetPos(-kWorldLim, y, 0.0);
      y += 2.4 * s + 3.0;
   }
}

// D -- WORLD mode, constant size, rotated about y (top row) then x (bottom row).
static void PanelD(REveElement *h)
{
   AddBBoxAnchor(h, kWorldLim);
   const double d2r = TMath::Pi() / 180.0;
   const int angles[] = {0, 20, 40, 60, 75};
   for (int i = 0; i < 5; ++i) {
      auto t = MakeText(h, Form("D_rotY_%02d", angles[i]), Form("Y%02d %s", angles[i], kRuler),
                        "LiberationSans-Regular", 0, 8.0f, kGreen + 3);
      auto &tr = t->RefMainTrans();
      tr.SetPos(-kWorldLim, 20.0 * i + 10.0, 0.0);
      tr.SetRotByAngles(0.0, angles[i] * d2r, 0.0);
   }
   for (int i = 0; i < 5; ++i) {
      auto t = MakeText(h, Form("D_rotX_%02d", angles[i]), Form("X%02d %s", angles[i], kRuler),
                        "LiberationSans-Regular", 0, 8.0f, kMagenta + 2);
      auto &tr = t->RefMainTrans();
      tr.SetPos(-kWorldLim, -20.0 * i - 10.0, 0.0);
      tr.SetRotByAngles(angles[i] * d2r, 0.0, 0.0);
   }
}

// E -- MIXED mode: world anchor, screen size, front facing. All five lines must
// come out the same size on screen; if they shrink with depth the mode has
// fallen back to world-space scaling.
static void PanelE(REveElement *h)
{
   AddBBoxAnchor(h, kWorldLim);
   for (int i = 0; i < 5; ++i) {
      double z = -kWorldLim + i * (2.0 * kWorldLim / 4.0);
      auto t = MakeText(h, Form("E_%02d_z_%+.0f", i, z), Form("z%+.0f %s", z, kRuler), "LiberationSans-Regular", 2,
                        0.022f, kOrange + 7);
      t->RefMainTrans().SetPos(-kWorldLim, -kWorldLim + i * 45.0, z);
   }
}

//------------------------------------------------------------------------------
/// Show only the named panel ("A".."E"); empty string shows all of them.
/// Callable from the ROOT prompt while the macro is running.

void tg_only(const char *panel = "")
{
   REveManager::ChangeGuard ch;
   std::string want(panel);
   for (auto &[name, el] : gPanels) {
      bool on = want.empty() || name == want;
      el->SetRnrSelf(on);
      el->SetRnrChildren(on);
   }
}

//------------------------------------------------------------------------------

/// \param panels which panels to build, e.g. "ABCDE" (all) or "CDE" (world+mixed only).
///        Building a subset matters: screen-mode text geometry lives in [0,1]
///        screen coordinates but still sits in the same RenderCore scene graph,
///        and the client frames the camera with Box3.setFromObject() over that
///        graph -- so a scene that contains screen text gets its camera fitted to
///        the [0,1] quad instead of to the real geometry.
void texts_grid(const char *panels = "ABCDE")
{
   std::string want(panels);
   auto eveMng = REveManager::Create();
   eveMng->AllowMultipleRemoteConnections(false, false);

   // Fonts are expected to be pre-generated in ui5/eve7/sdf-fonts/. AssertSdfFont
   // is a no-op when both the .png and the .js.gz are there; it only needs a GL
   // context (and hence a display) when it actually has to build one.
   std::string rf = std::string(TROOT::GetDataDir().Data()) + "/fonts/";
   for (int i = 0; i < kNFonts; ++i)
      REveText::AssertSdfFont(kFonts[i], rf + kFonts[i] + ".ttf");

   // One scene per mode, so a mode can be switched off in the browser tree; one
   // holder per panel, so tg_only() can isolate a panel from the prompt.
   auto *scScreen = eveMng->SpawnNewScene("Screen text", "Panels A, B -- screen mode");
   auto *scWorld = eveMng->SpawnNewScene("World text", "Panels C, D -- world mode");
   auto *scMixed = eveMng->SpawnNewScene("Mixed text", "Panel E -- mixed mode");

   struct { const char *key; const char *name; REveScene *scene; void (*fill)(REveElement *); } defs[] = {
      {"A", "A_screen_size_ladder",   scScreen, PanelA},
      {"B", "B_screen_fonts",         scScreen, PanelB},
      {"C", "C_world_size_ladder",    scWorld,  PanelC},
      {"D", "D_world_rotation_fan",   scWorld,  PanelD},
      {"E", "E_mixed_depth_ladder",   scMixed,  PanelE},
   };
   for (auto &d : defs) {
      if (want.find(d.key) == std::string::npos)
         continue;
      auto *h = new REveElement(d.name);
      d.fill(h);
      d.scene->AddElement(h);
      gPanels[d.key] = h;
   }

   // Multi-view: the same scenes through two viewers. Besides being the canonical
   // REve demo, it puts a perspective and an orthographic camera on identical
   // geometry -- the cheapest way to see whether SDF antialiasing is
   // camera-dependent.
   auto *v0 = (REveViewer *)eveMng->GetViewers()->FirstChild();
   v0->SetName("Perspective");
   v0->SetCameraType(REveViewer::kCameraPerspXOY); // XY plane face-on: panels C/D live there
   auto *v1 = eveMng->SpawnNewViewer("Orthographic", "Same scenes, ortho camera");
   v1->SetCameraType(REveViewer::kCameraOrthoXOY);

   for (auto *v : {v0, v1}) {
      v->AddScene(scScreen);
      v->AddScene(scWorld);
      v->AddScene(scMixed);
      v->SetAxesType(REveViewer::kAxesEdge);
   }

   eveMng->Show();
}
