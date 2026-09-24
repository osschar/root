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

#include <cmath>

using namespace ROOT::Experimental;

/** \class REveSMorph
\ingroup REve
Parametric, texture-mapped surface of spherical topology. See the header for
the parametrisation and for why the geometry is built on the client.
*/

////////////////////////////////////////////////////////////////////////////////

REveSMorph::REveSMorph(const std::string &n, const std::string &t) : REveElement(n, t)
{
   SetMainColorPtr(&fColor);
}

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

   // Bounding box as JSON, min triple then max triple, ready for RC.Box3.
   //
   // Not in the render-data normals channel, where REveBoxSet and REvePointSet
   // put theirs. Those two have no choice: they are drawn instanced, with a
   // single primitive as geometry and every placement in a data texture the
   // shader reads, so RenderCore cannot know the extent of what it is about to
   // draw -- there may be a million instances of it. Here the client generates
   // real geometry and could measure it; the box is streamed only because the
   // server has it in closed form already. That does not justify putting
   // numbers in an array named for normals.
   ComputeBBox();
   const Float_t *bb = GetBBox();
   j["bbox"] = {bb[0], bb[2], bb[4], bb[1], bb[3], bb[5]};

   return ret;
}

////////////////////////////////////////////////////////////////////////////////
/// Bounding box: fixed at unit extent, in the element's own frame.
///
/// Deliberately NOT tracking the morph. fCx can push the surface out past 1 and
/// this box will not follow, which is a real if modest under-estimate -- and it
/// is the better trade. The scene box is the union of what is in the scene and
/// the 3D axis takes its extents from it, so a box that tracked fCx would move
/// the axis while somebody dragged the fCx slider. An axis that rescales itself
/// as you adjust a shape is worse than one that is a few per cent small.
///
/// The surface is generated at unit size and scaled by the element's own
/// transformation, so this is the whole of it for anything unmorphed.
///
/// Worth knowing: the client transforms this box by taking its corners, so a
/// ROTATED object's world-axis-aligned box is inflated -- up to sqrt(3) for a
/// cube rotated to point a corner along an axis. That is not fixable here. A
/// sphere needs a bounding sphere, and RenderCore has no such thing; a box is
/// all there is to give it.

void REveSMorph::ComputeBBox()
{
   BBoxInit();
   BBoxCheckPoint(-1.f, -1.f, -1.f);
   BBoxCheckPoint( 1.f,  1.f,  1.f);
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
