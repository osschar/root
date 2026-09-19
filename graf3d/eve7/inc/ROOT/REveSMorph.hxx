// @(#)root/eve7:$Id$
// Author: Matevz Tadel

/*************************************************************************
 * Copyright (C) 1995-2025, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT7_REveSMorph
#define ROOT7_REveSMorph

#include <ROOT/REveElement.hxx>

#include <string>

namespace ROOT {
namespace Experimental {

////////////////////////////////////////////////////////////////////////////////
/// REveSMorph
///
/// A parametric, texture-mapped surface of spherical topology -- a sphere that
/// can be twisted, pinched and sheared, and cut down to a patch in theta and
/// phi. Ported from Gled's `SMorph` (libsets/Geom1/Glasses/SMorph.{h,cxx}),
/// whose parameter names it keeps so the two can be read side by side.
///
/// **The geometry is built on the client, not here.** That is unusual for REve,
/// where tessellation is normally server-side, and it is deliberate: this
/// surface is textured, and `REveRenderData` has no channel for texture
/// coordinates -- only vertices, normals, indices and the transformation
/// matrix. Rather than widen the wire format for every element that will never
/// have a UV, the parameters are streamed and `makeSMorph` in
/// `EveElementsRCore.js` runs the same construction there. `REveLogo` streams
/// itself the same way and for a related reason.
///
/// The surface is generated at unit size and scaled by the element's own
/// transformation, exactly as Gled's SMorph used its ZNode scale. So the radius
/// costs nothing to animate: it rides in `fMainTrans` along with position and
/// orientation, and a change to any of them streams as one matrix under
/// kCBTransBBox without the client rebuilding anything. Everything else here is
/// shape, and changing it does force a rebuild -- hence StampObjProps().
///
/// The parametrisation, with ct = cos(theta), st = sin(theta):
///
///     twist = ct * fTx,  conv = ct * fCx
///     x = ct
///     y = (1 + conv) * st * cos(phi + twist)
///     z = (1 + conv) * st * sin(phi + twist)
///
/// followed by a rotation about z through x * fRz, which shears the whole body
/// along its polar axis. Note the polar axis is **x**, as in the original, not
/// the more usual z. The normal is taken to be the position itself, which is
/// exact for the unmorphed sphere and a good approximation for small fTx, fCx
/// and fRz -- also as in the original.
///
/// Texture coordinates are laid out as
///
///     u = fTexX0 + fTexXC * phi / 2pi
///     v = fTexY0 + fTexYC * acos(ct) / pi
///
/// with fTexYOff, if set, adding int(v) * fTexYOff to u, which offsets
/// successive wraps against each other -- a brick bond rather than a grid.
///
/// Worked example: `tutorials/visualisation/eve7/boing.C`.
////////////////////////////////////////////////////////////////////////////////

class REveSMorph : public REveElement
{
private:
   REveSMorph(const REveSMorph &) = delete;
   REveSMorph &operator=(const REveSMorph &) = delete;

protected:
   // Tessellation. GUI range [2, 100] / [3, 100], step 1.
   Int_t   fTLevel{24};     ///< divisions in theta
   Int_t   fPLevel{32};     ///< divisions in phi

   // Morph. All zero is a plain sphere. GUI range [-10, 10], step 0.01.
   Float_t fTx{0.f};        ///< twist of phi, proportional to cos(theta)
   Float_t fCx{0.f};        ///< radial convergence, proportional to cos(theta)
   Float_t fRz{0.f};        ///< shear about z, proportional to x

   // Extent, as fractions of the full ranges. GUI range [0, 1], step 0.001.
   Float_t fThetaMin{0.f};  ///< theta from fThetaMin * pi
   Float_t fThetaMax{1.f};  ///< theta to   fThetaMax * pi
   Float_t fPhiMean{0.5f};  ///< phi centred on fPhiMean * 2pi
   Float_t fPhiRange{1.f};  ///< phi spanning fPhiRange * 2pi; 1 closes the seam

   /// Space the theta rings by equal surface area rather than by equal angle,
   /// which keeps the quads near the poles from collapsing.
   Bool_t  fEquiSurf{kFALSE};

   /// File name under ui5/eve7/textures/. Empty draws in the main colour.
   std::string fTexture;

   Float_t fTexX0{0.f};     ///< u offset
   Float_t fTexY0{1.f};     ///< v offset
   Float_t fTexXC{1.f};     ///< u wraps per turn in phi
   Float_t fTexYC{-1.f};    ///< v wraps per sweep in theta
   Float_t fTexYOff{0.f};   ///< u shift per whole v, for a brick bond

public:
   REveSMorph(const std::string &n = "REveSMorph", const std::string &t = "");
   ~REveSMorph() override = default;

   Int_t GetTLevel() const { return fTLevel; }
   Int_t GetPLevel() const { return fPLevel; }
   void  SetTLevel(Int_t l);
   void  SetPLevel(Int_t l);

   Float_t GetTx() const { return fTx; }
   Float_t GetCx() const { return fCx; }
   Float_t GetRz() const { return fRz; }
   void    SetTx(Float_t v);
   void    SetCx(Float_t v);
   void    SetRz(Float_t v);

   Float_t GetThetaMin()  const { return fThetaMin; }
   Float_t GetThetaMax()  const { return fThetaMax; }
   Float_t GetPhiMean()   const { return fPhiMean; }
   Float_t GetPhiRange()  const { return fPhiRange; }
   void    SetThetaMin(Float_t v);
   void    SetThetaMax(Float_t v);
   void    SetPhiMean(Float_t v);
   void    SetPhiRange(Float_t v);

   Bool_t GetEquiSurf() const { return fEquiSurf; }
   void   SetEquiSurf(Bool_t x);

   const std::string &GetTexture() const { return fTexture; }
   void SetTexture(const std::string &f);

   Float_t GetTexX0()   const { return fTexX0; }
   Float_t GetTexY0()   const { return fTexY0; }
   Float_t GetTexXC()   const { return fTexXC; }
   Float_t GetTexYC()   const { return fTexYC; }
   Float_t GetTexYOff() const { return fTexYOff; }
   void    SetTexX0(Float_t v);
   void    SetTexY0(Float_t v);
   void    SetTexXC(Float_t v);
   void    SetTexYC(Float_t v);
   void    SetTexYOff(Float_t v);

   /// Uniform scale on the main transformation. A convenience, and a reminder
   /// that size here is transformation and not geometry: this stamps
   /// kCBTransBBox, so it streams as a matrix and rebuilds nothing.
   void SetRadius(Float_t r);

   Int_t WriteCoreJson(nlohmann::json &j, Int_t rnr_offset) override;
   void  BuildRenderData() override;
};

} // namespace Experimental
} // namespace ROOT

#endif
