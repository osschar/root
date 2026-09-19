// @(#)root/eve7:$Id$
// Author: Matevz Tadel

/*************************************************************************
 * Copyright (C) 1995-2025, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#include <ROOT/REveSMorph.hxx>
#include <ROOT/REveRenderData.hxx>
#include <ROOT/REveTrans.hxx>

#include <algorithm>

using namespace ROOT::Experimental;

/** \class REveSMorph
\ingroup REve
Parametric, texture-mapped surface of spherical topology. See the header for
the parametrisation and for why the geometry is built on the client.
*/

////////////////////////////////////////////////////////////////////////////////

REveSMorph::REveSMorph(const std::string &n, const std::string &t) : REveElement(n, t)
{
}

////////////////////////////////////////////////////////////////////////////////
/// Shape setters. Every one of these changes the generated geometry, so each
/// stamps kCBObjProps and the client rebuilds. Size does not belong here -- it
/// is the transformation, see SetRadius().
///
/// The clamps double as the GUI ranges: Ged sliders for this class mirror them
/// exactly, so moving a clamp means moving the slider with it. (That
/// duplication is what the "extract Ged descriptions at build time" item in
/// REVE-OPEN-ITEMS.md is about -- in Gled these bounds were written once, in
/// the member comment, and the GUI was generated from them.)

void REveSMorph::SetTLevel(Int_t l)
{
   fTLevel = std::clamp(l, 2, 200);
   StampObjProps();
}

void REveSMorph::SetPLevel(Int_t l)
{
   fPLevel = std::clamp(l, 3, 200);
   StampObjProps();
}

void REveSMorph::SetTx(Float_t v) { fTx = std::clamp(v, -10.f, 10.f); StampObjProps(); }
void REveSMorph::SetCx(Float_t v) { fCx = std::clamp(v, -10.f, 10.f); StampObjProps(); }
void REveSMorph::SetRz(Float_t v) { fRz = std::clamp(v, -10.f, 10.f); StampObjProps(); }

/// Theta and phi extents. Deliberately not cross-checked: fThetaMin above
/// fThetaMax sweeps the surface backwards, which is harmless and occasionally
/// what you want. The original did not guard it either.
void REveSMorph::SetThetaMin(Float_t v) { fThetaMin = std::clamp(v, 0.f, 1.f); StampObjProps(); }
void REveSMorph::SetThetaMax(Float_t v) { fThetaMax = std::clamp(v, 0.f, 1.f); StampObjProps(); }
void REveSMorph::SetPhiMean(Float_t v)  { fPhiMean  = std::clamp(v, 0.f, 1.f); StampObjProps(); }
void REveSMorph::SetPhiRange(Float_t v) { fPhiRange = std::clamp(v, 0.f, 1.f); StampObjProps(); }

void REveSMorph::SetEquiSurf(Bool_t x) { fEquiSurf = x; StampObjProps(); }

void REveSMorph::SetTexture(const std::string &f) { fTexture = f; StampObjProps(); }

void REveSMorph::SetTexX0(Float_t v)   { fTexX0   = std::clamp(v, -1e3f, 1e3f); StampObjProps(); }
void REveSMorph::SetTexY0(Float_t v)   { fTexY0   = std::clamp(v, -1e3f, 1e3f); StampObjProps(); }
void REveSMorph::SetTexXC(Float_t v)   { fTexXC   = std::clamp(v, -1e3f, 1e3f); StampObjProps(); }
void REveSMorph::SetTexYC(Float_t v)   { fTexYC   = std::clamp(v, -1e3f, 1e3f); StampObjProps(); }
void REveSMorph::SetTexYOff(Float_t v) { fTexYOff = std::clamp(v, -1e3f, 1e3f); StampObjProps(); }

////////////////////////////////////////////////////////////////////////////////
/// Uniform scale on the main transformation.
///
/// Note which stamp this is: the surface is generated at unit size, so size is
/// transformation and not geometry. It streams as a matrix and the client moves
/// the object it already has -- no rebuild, however fast it is driven.

void REveSMorph::SetRadius(Float_t r)
{
   RefMainTrans().SetScale(r, r, r);
   StampTransBBox();
}

////////////////////////////////////////////////////////////////////////////////

Int_t REveSMorph::WriteCoreJson(nlohmann::json &j, Int_t rnr_offset)
{
   Int_t ret = REveElement::WriteCoreJson(j, rnr_offset);

   j["fTLevel"]   = fTLevel;
   j["fPLevel"]   = fPLevel;

   j["fTx"]       = fTx;
   j["fCx"]       = fCx;
   j["fRz"]       = fRz;

   j["fThetaMin"] = fThetaMin;
   j["fThetaMax"] = fThetaMax;
   j["fPhiMean"]  = fPhiMean;
   j["fPhiRange"] = fPhiRange;
   j["fEquiSurf"] = fEquiSurf;

   j["fTexture"]  = fTexture;
   j["fTexX0"]    = fTexX0;
   j["fTexY0"]    = fTexY0;
   j["fTexXC"]    = fTexXC;
   j["fTexYC"]    = fTexYC;
   j["fTexYOff"]  = fTexYOff;

   return ret;
}

////////////////////////////////////////////////////////////////////////////////
/// No geometry is written -- makeSMorph builds it from the fields above. The
/// render-data block still has to exist, because the client dispatches on
/// render_data.rnr_func, and the base call is what puts the transformation in
/// it. One vertex keeps the buffer non-empty, as REveLogo does.

void REveSMorph::BuildRenderData()
{
   fRenderData = std::make_unique<REveRenderData>("makeSMorph");
   REveElement::BuildRenderData();
   fRenderData->PushV(0.f, 0.f, 0.f);
}
