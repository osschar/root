// @(#)root/eve7:$Id$
// Authors: Matevz Tadel & Alja Mrak-Tadel

/*************************************************************************
 * Copyright (C) 1995-2019, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#include <ROOT/REveProjectionAxis.hxx>
#include <ROOT/REveProjectionManager.hxx>
#include <ROOT/REveProjections.hxx>
#include <ROOT/REveRenderData.hxx>

#include "THLimitsFinder.h"
#include "TMath.h"
#include "TString.h"

#include <cmath>

using namespace ROOT::Experimental;

/** \class REveProjectionAxis
\ingroup REve
Scales and tick labels for a projected view. See the header for the reasoning
behind computing ticks on the server and over-providing them.
*/

namespace {

/// Decimals needed to tell neighbouring ticks apart, given the step between them.
std::string FormatTickLabel(Double_t v, Double_t step)
{
   if (std::fabs(v) < 1e-12) return "0";

   Int_t nd = 0;
   if (step > 0.0 && step < 1.0)
      nd = TMath::Min(6, (Int_t)std::ceil(-std::log10(step)));

   // Very large or very small numbers read better in exponent form.
   Double_t a = std::fabs(v);
   if (a >= 1e5 || a < 1e-4)
      return TString::Format("%.1e", v).Data();

   return TString::Format("%.*f", nd, v).Data();
}

} // namespace

////////////////////////////////////////////////////////////////////////////////
/// Constructor. The manager is taken as an aunt: REveProjectionManager keeps its
/// nieces as the elements it projects, and ProjectChildrenRecurse() only acts on
/// REveProjected, so a plain element like this one is visited and skipped. The
/// link therefore costs nothing and is cleaned up from either side.

REveProjectionAxis::REveProjectionAxis(REveProjectionManager *m, const Text_t *n, const Text_t *t)
   : REveText(n, t), fManager(m)
{
   // Inherited style defaults that make sense for tick labels rather than for a
   // free-standing text box.
   SetMode(1);          // screen space; the client places the labels itself
   // A projected view is often a small pane, where 0.022 of its height is under
   // ten pixels of cap height and a stroke is about one pixel wide -- thin and
   // ragged, since coverage then varies along the stroke. A little more size and
   // a little synthetic weight cost nothing and fix both; neither needs a
   // second, heavier atlas.
   SetFontSize(0.028f);
   SetFontWeight(0.06f);
   SetDrawFrame(kFALSE);
   SetTextAlign(kCenterH, kTop);

   if (fManager)
      fManager->AddNiece(this);

   UpdateTicks();
}

////////////////////////////////////////////////////////////////////////////////
/// Destructor. The aunt link is dropped by REveElement's own cleanup, which
/// calls RemoveNieceInternal() on every aunt, so nothing to do here.

REveProjectionAxis::~REveProjectionAxis()
{
}

////////////////////////////////////////////////////////////////////////////////
/// Recompute both axes. Call after the projection or the scene extent changes.

void REveProjectionAxis::UpdateTicks()
{
   BuildTicks(0);
   BuildTicks(1);
   StampObjProps();
}

////////////////////////////////////////////////////////////////////////////////
/// Build the tick set for one screen axis, 0 horizontal and 1 vertical.
///
/// The range comes from the projection manager's bounding box, widened by
/// fRangeFactor. Widening is the over-provisioning: the client is expected to
/// discard what its frustum does not show, and in return it can zoom and pan
/// without asking the server for anything.

void REveProjectionAxis::BuildTicks(Int_t ax)
{
   fTicks[ax].clear();

   if (!fManager) return;
   REveProjection *proj = fManager->GetProjection();
   if (!proj) return;

   fManager->AssertBBox();
   Float_t *bb = fManager->GetBBox();
   if (!bb) return;

   Float_t pmin_t = bb[ax * 2], pmax_t = bb[ax * 2 + 1];
   if (pmax_t <= pmin_t) return;

   // Two ranges, and the distinction matters. The TRUE range is what the view
   // actually shows and is what the tick STEP must be derived from; the WIDENED
   // range only says how far beyond the view to keep emitting ticks at that step.
   // Deriving the step from the widened range instead lets THLimitsFinder jump to
   // a coarser round number -- doubling the range can take the step from 200 to
   // 1000 -- which leaves fewer labels inside the view than no over-provisioning
   // at all. That is a real bug that was visible as "only 0 is labelled" once a
   // projection distortion pushed the widened bounds over a round-number boundary.
   Float_t center = 0.5f * (pmin_t + pmax_t);
   Float_t half = 0.5f * (pmax_t - pmin_t) * fRangeFactor;
   Float_t pmin = center - half;
   Float_t pmax = center + half;

   // TAttAxis convention: n1 + 100 * n2, primary and secondary divisions.
   Int_t n1a = TMath::FloorNint(fNdivisions / 100);
   Int_t n2a = fNdivisions - n1a * 100;
   Int_t bn1, bn2;
   Double_t bw1, bw2;
   Double_t bl1 = 0, bh1 = 0, bl2 = 0, bh2 = 0;

   if (fLabMode == kValue) {
      // Round numbers in the ORIGINAL space, placed where the projection puts
      // them. Their screen spacing is uneven, which is the whole point.
      Float_t v1 = proj->GetValForScreenPos(ax, pmin_t);
      Float_t v2 = proj->GetValForScreenPos(ax, pmax_t);
      if (v2 <= v1) return;

      // Step from the true range (see above), extent from the widened one.
      THLimitsFinder::Optimize(v1, v2, n1a, bl1, bh1, bn1, bw1);
      THLimitsFinder::Optimize(bl1, bl1 + bw1, n2a, bl2, bh2, bn2, bw2);
      if (bw1 <= 0) return;

      Double_t vc = 0.5 * (v1 + v2), vh = 0.5 * (v2 - v1) * fRangeFactor;
      Int_t k1 = TMath::FloorNint((vc - vh - bl1) / bw1);
      Int_t k2 = TMath::CeilNint((vc + vh - bl1) / bw1);

      // Cached for the cheap per-tick form of GetScreenVal().
      REveVector dirVec;
      proj->SetDirectionalVector(ax, dirVec);
      REveVector oCenter;
      proj->GetOrthogonalCenter(ax, oCenter);

      for (Int_t l = k1; l <= k2; ++l) {
         Double_t v = bl1 + l * bw1;
         Tick_t major;
         major.fPos = proj->GetScreenVal(ax, v);
         major.fLabel = FormatTickLabel(v, bw1);
         major.fMajor = kTRUE;
         fTicks[ax].push_back(major);

         for (Int_t k = 1; k < bn2; ++k) {
            Tick_t minor;
            minor.fPos = proj->GetScreenVal(ax, v + k * bw2, dirVec, oCenter);
            minor.fMajor = kFALSE;
            fTicks[ax].push_back(minor);
         }
      }
   } else {
      // Even spacing in projected space; the labels are then irregular values.
      // Step from the true range here too, for the same reason.
      THLimitsFinder::Optimize(pmin_t, pmax_t, n1a, bl1, bh1, bn1, bw1);
      THLimitsFinder::Optimize(bl1, bl1 + bw1, n2a, bl2, bh2, bn2, bw2);
      if (bw1 <= 0) return;

      Int_t k1 = TMath::CeilNint(pmin / bw1);
      Int_t k2 = TMath::FloorNint(pmax / bw1);

      for (Int_t l = k1; l <= k2; ++l) {
         Double_t p = l * bw1;

         Tick_t major;
         major.fPos = p;
         major.fLabel = FormatTickLabel(proj->GetValForScreenPos(ax, p), bw1);
         major.fMajor = kTRUE;
         fTicks[ax].push_back(major);

         for (Int_t k = 1; k < bn2; ++k) {
            Double_t pm = p + k * bw2;
            if (pm > pmax) break;
            Tick_t minor;
            minor.fPos = pm;
            minor.fMajor = kFALSE;
            fTicks[ax].push_back(minor);
         }
      }
   }
}

////////////////////////////////////////////////////////////////////////////////
/// Stream style, mode and the tick sets. Positions are in projected
/// coordinates; the client maps them to screen with its own camera.

Int_t REveProjectionAxis::WriteCoreJson(nlohmann::json &j, Int_t rnr_offset)
{
   Int_t ret = REveText::WriteCoreJson(j, rnr_offset);

   j["fLabMode"] = (int)fLabMode;
   j["fAxesMode"] = (int)fAxesMode;
   j["fUseFgColor"] = fUseFgColor;
   j["fDrawCenter"] = fDrawCenter;
   j["fDrawOrigin"] = fDrawOrigin;

   for (int ax = 0; ax < 2; ++ax) {
      nlohmann::json pos = nlohmann::json::array();
      nlohmann::json lab = nlohmann::json::array();
      nlohmann::json maj = nlohmann::json::array();
      for (auto &t : fTicks[ax]) {
         pos.push_back(t.fPos);
         lab.push_back(t.fLabel);
         maj.push_back(t.fMajor);
      }
      std::string key = (ax == 0) ? "H" : "V";
      j["fTickPos" + key] = pos;
      j["fTickLab" + key] = lab;
      j["fTickMaj" + key] = maj;
   }

   return ret;
}

////////////////////////////////////////////////////////////////////////////////
/// Render data. The ticks travel as JSON above, since the labels are strings;
/// this only names the client-side factory.

void REveProjectionAxis::BuildRenderData()
{
   fRenderData = std::make_unique<REveRenderData>("makeProjectionAxis");
   REveElement::BuildRenderData();
   fRenderData->PushV(0.f, 0.f, 0.f); // keep the buffer non-empty
}

////////////////////////////////////////////////////////////////////////////////
/// Step the distortion and reproject. MIR target for the overlay buttons.

void REveProjectionAxis::BumpDistortion(Int_t steps)
{
   if (!fManager) return;
   REveProjection *proj = fManager->GetProjection();
   if (!proj) return;

   Float_t d = proj->GetDistortion() + steps * 1e-4f;
   if (d < 0.f) d = 0.f;
   proj->SetDistortion(d);

   // The manager's name carries the distortion, so it has to be refreshed for
   // the Summary tree; then the projected geometry, then our own ticks, whose
   // spacing is a function of the projection.
   fManager->UpdateName();
   fManager->ProjectChildren();
   UpdateTicks();
   UpdateDistortionLabel();
}

////////////////////////////////////////////////////////////////////////////////

void REveProjectionAxis::SetDistortionLabel(REveText *t)
{
   fDistLabel = t;
   UpdateDistortionLabel();
}

////////////////////////////////////////////////////////////////////////////////
/// Rewrite the read-out. Shown as distortion * 1000, the same scaling
/// REveProjectionManager uses in its own name.

void REveProjectionAxis::UpdateDistortionLabel()
{
   if (!fDistLabel || !fManager) return;
   REveProjection *proj = fManager->GetProjection();
   if (!proj) return;

   fDistLabel->SetText(TString::Format("%.1f", proj->GetDistortion() * 1000).Data());
}
