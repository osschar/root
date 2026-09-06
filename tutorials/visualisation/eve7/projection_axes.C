/// \file
/// \ingroup tutorial_eve_7
/// Scales and tick labels for a projected view, using REveProjectionAxis.
///
/// This is the REve counterpart of the old TEve projection.C. A barrel and a few
/// jets are projected in RhoPhi and RhoZ, and each projected view gets an axis.
///
/// Ticks sit at round numbers in the *original* space and are drawn where the
/// projection puts them, so with a non-zero distortion their spacing on screen
/// becomes uneven -- that unevenness is the information the axis carries. Try it:
///
///     pa_distortion(0.001)   // then 0.005, and back to 0
///
/// The division of labour is worth knowing. The projection can be arbitrarily
/// non-linear and exists only on the server, so the mapping original -> projected
/// happens there, once, and the tick set is streamed deliberately over-provided:
/// a wider range and finer subdivision than any one view needs. The client is
/// left with projected -> screen, which for the orthographic camera of a 2D
/// projected view is affine, so it filters and re-lays the labels itself on every
/// zoom and pan without ever asking the server. Only a change to the projection
/// needs a round trip.
///
/// The axes live in overlay scenes: drawn by their own orthographic camera into
/// their own depth buffer, so they stay in front of the geometry.
///
/// \macro_code
///
/// \author Matevz Tadel

#include <ROOT/REveElement.hxx>
#include <ROOT/REveGeoShape.hxx>
#include <ROOT/REveJetCone.hxx>
#include <ROOT/REveManager.hxx>
#include <ROOT/REveProjectionAxis.hxx>
#include <ROOT/REveProjectionManager.hxx>
#include <ROOT/REveScene.hxx>
#include <ROOT/REveText.hxx>
#include <ROOT/REveViewer.hxx>

#include "TColor.h"
#include "TGeoTube.h"
#include "TMath.h"
#include "TRandom.h"

using namespace ROOT::Experimental;

REveProjectionManager *gPaRPhi = nullptr;
REveProjectionManager *gPaRhoZ = nullptr;
REveProjectionAxis *gPaAxisRPhi = nullptr;
REveProjectionAxis *gPaAxisRhoZ = nullptr;

const Double_t kR_min = 240;
const Double_t kR_max = 250;
const Double_t kZ_d = 300;

//------------------------------------------------------------------------------
/// Change the distortion of both projections and rebuild the tick sets.
/// Callable from the ROOT prompt while the macro runs. This is the one operation
/// that genuinely needs the server: the projection changed, so the ticks move.

void pa_distortion(float d)
{
   REveManager::ChangeGuard ch;
   for (auto mng : {gPaRPhi, gPaRhoZ}) {
      if (!mng) continue;
      mng->GetProjection()->SetDistortion(d);
      mng->UpdateName();
      mng->ProjectChildren();
   }
   if (gPaAxisRPhi) gPaAxisRPhi->UpdateTicks();
   if (gPaAxisRhoZ) gPaAxisRhoZ->UpdateTicks();
}

//------------------------------------------------------------------------------

static REveElement *makeSceneContent(REveManager *eveMng)
{
   auto holder = new REveElement("Content");

   auto b = new REveGeoShape("Barrel");
   b->SetShape(new TGeoTube(kR_min, kR_max, kZ_d));
   b->SetMainColor(kCyan);
   b->SetMainTransparency(60);
   b->SetNSegments(64);
   holder->AddElement(b);

   TRandom &r = *gRandom;
   for (int i = 0; i < 4; ++i) {
      auto jet = new REveJetCone(Form("Jet_%d", i));
      jet->SetCylinder(2 * kR_max, 2 * kZ_d);
      jet->AddEllipticCone(r.Uniform(-2.5, 2.5), r.Uniform(0, TMath::TwoPi()), r.Uniform(0.05, 0.2),
                           r.Uniform(0.05, 0.25));
      jet->SetFillColor(kPink - 8);
      jet->SetLineColor(kBlack);
      holder->AddElement(jet);
   }

   eveMng->GetEventScene()->AddElement(holder);
   return holder;
}

/// One projected view: a scene for the projected geometry, an overlay scene for
/// its axis, and an orthographic viewer showing both.
static void makeProjectedView(REveManager *eveMng, REveElement *content, REveProjection::EPType_e type,
                              const char *name, REveProjectionManager *&mng, REveProjectionAxis *&axis)
{
   auto scene = eveMng->SpawnNewScene(Form("%s Scene", name), name);
   mng = new REveProjectionManager(type);
   mng->ImportElements(content, scene);

   auto ovl = eveMng->SpawnNewScene(Form("%s Axis", name), name);
   ovl->SetIsOverlay(true);

   axis = new REveProjectionAxis(mng, Form("%s Axis", name));
   axis->SetFontSize(0.022);
   axis->SetTextColor(TColor::GetColor("#1f2d36"));
   axis->SetLineColor(TColor::GetColor("#6b8290"));
   axis->SetFont("LiberationSans-Regular");
   ovl->AddElement(axis);

   auto view = eveMng->SpawnNewViewer(Form("%s View", name), "");
   view->SetCameraType(REveViewer::kCameraOrthoXOY);
   view->AddScene(scene);
   view->AddScene(ovl);
}

void projection_axes()
{
   auto eveMng = REveManager::Create();
   eveMng->AllowMultipleRemoteConnections(false, false);

   REveText::AssertSdfFont("LiberationSans-Regular",
                           "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf");

   auto content = makeSceneContent(eveMng);

   makeProjectedView(eveMng, content, REveProjection::kPT_RPhi, "RPhi", gPaRPhi, gPaAxisRPhi);
   makeProjectedView(eveMng, content, REveProjection::kPT_RhoZ, "RhoZ", gPaRhoZ, gPaAxisRhoZ);

   eveMng->Show();
}
