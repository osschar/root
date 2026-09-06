// @(#)root/eve7:$Id$
// Authors: Matevz Tadel & Alja Mrak-Tadel

/*************************************************************************
 * Copyright (C) 1995-2019, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT7_REveProjectionAxis
#define ROOT7_REveProjectionAxis

#include <ROOT/REveText.hxx>

#include <string>
#include <vector>

namespace ROOT {
namespace Experimental {

class REveProjectionManager;

////////////////////////////////////////////////////////////////////////////////
/// REveProjectionAxis
///
/// Scales and tick labels for a projected view, the REve counterpart of
/// TEveProjectionAxes.
///
/// Ticks sit at round numbers in the *original* space and are placed at their
/// projected positions, so under a non-linear projection their spacing on screen
/// is deliberately uneven -- that unevenness is the information. The projection
/// itself can be arbitrarily non-trivial and lives only on the server, so the
/// mapping original -> projected is done here, once, and the result is streamed.
///
/// The client is then left with projected -> screen, which for the orthographic
/// camera of a 2D projected view is affine and which it already owns. That is
/// what keeps zooming and panning free of server round-trips.
///
/// For the same reason the tick set is deliberately **over-provided**: rather
/// than computing exactly what fits the current frustum, a generous range at a
/// finer subdivision is sent, and the client filters it -- discarding what falls
/// outside the view and what would overlap. Re-streaming is then only needed when
/// the projection or the scene extent changes, not on every zoom.
///
/// The projection manager is held as an aunt, so the link does not imply
/// ownership and is cleaned up on either side.
///
/// Inherits REveText for its style: font, size, colour and the frame settings
/// apply to the tick labels. Of the inherited fields, fText is the axis title;
/// fPosition, fMode and fResizable do not apply.
////////////////////////////////////////////////////////////////////////////////

class REveProjectionAxis : public REveText
{
public:
   /// Where the labelled values come from.
   ///   kValue    round numbers in original space, unevenly spaced on screen
   ///   kPosition evenly spaced on screen, irregular label values
   enum ELabMode_e { kValue = 0, kPosition };

   /// Which edges of the viewport carry an axis.
   enum EAxesMode_e { kHorizontal = 0, kVertical, kAll };

   /// One tick: where it lands in projected space, what to write, and whether it
   /// is a labelled (major) tick or a bare subdivision.
   struct Tick_t {
      Float_t     fPos{0};      ///< position along the axis, in projected coordinates
      std::string fLabel;       ///< empty for a minor tick
      Bool_t      fMajor{true};
   };

private:
   REveProjectionAxis(const REveProjectionAxis &) = delete;
   REveProjectionAxis &operator=(const REveProjectionAxis &) = delete;

protected:
   REveProjectionManager *fManager{nullptr}; ///<! held as an aunt, not owned

   ELabMode_e  fLabMode{kValue};
   EAxesMode_e fAxesMode{kAll};

   /// As TAttAxis: n1 + 100 * n2, primary and secondary divisions. Deliberately
   /// finer than TAttAxis's usual 510. A projected axis is laid out by the
   /// client, which drops every label that will not fit, so asking for too few
   /// leaves it nothing to choose from: THLimitsFinder answers 5 divisions of
   /// [-600, 600] with a step of 500, i.e. three labels, two of which fall in
   /// the corners against the vertical scale and are discarded. Over-provide and
   /// let the filter decide -- the same bargain the tick range itself makes.
   Int_t   fNdivisions{1010};
   Float_t fRangeFactor{2.0};  ///< over-provision: extend past the scene extent by this factor
   Bool_t  fDrawCenter{kFALSE};
   Bool_t  fDrawOrigin{kFALSE};

   std::vector<Tick_t> fTicks[2]; ///<! computed ticks, [0] horizontal, [1] vertical

   REveText *fDistLabel{nullptr}; ///<! optional read-out of the distortion, not owned

   void BuildTicks(Int_t ax);

public:
   REveProjectionAxis(REveProjectionManager *m, const Text_t *n = "REveProjectionAxis",
                      const Text_t *t = "");
   ~REveProjectionAxis() override;

   REveProjectionManager *GetManager() const { return fManager; }

   ELabMode_e GetLabMode() const { return fLabMode; }
   void SetLabMode(ELabMode_e m) { fLabMode = m; StampObjProps(); }

   EAxesMode_e GetAxesMode() const { return fAxesMode; }
   void SetAxesMode(EAxesMode_e m) { fAxesMode = m; StampObjProps(); }

   Int_t GetNdivisions() const { return fNdivisions; }
   void SetNdivisions(Int_t n) { fNdivisions = n; StampObjProps(); }

   Float_t GetRangeFactor() const { return fRangeFactor; }
   void SetRangeFactor(Float_t f) { fRangeFactor = f; StampObjProps(); }

   Bool_t GetDrawCenter() const { return fDrawCenter; }
   void SetDrawCenter(Bool_t x) { fDrawCenter = x; StampObjProps(); }

   Bool_t GetDrawOrigin() const { return fDrawOrigin; }
   void SetDrawOrigin(Bool_t x) { fDrawOrigin = x; StampObjProps(); }

   /// Recompute the tick set. Call after the projection or the scene extent
   /// changes; the client needs no update on mere camera motion.
   void UpdateTicks();

   /// Step the projection's distortion and reproject. Public and in the
   /// dictionary because it is a MIR target: it is what the overlay's
   /// distortion buttons call.
   ///
   /// The step is additive in units of 1e-4, which is what the manager's own
   /// name formatting implies by reporting distortion * 1000, and it is
   /// clamped at zero -- a negative distortion is not meaningful and the
   /// projections divide by 1 + |x| * distortion.
   void BumpDistortion(Int_t steps);

   /// Attach a text element to display the current distortion. Not owned; the
   /// axis only rewrites its string, so the label can live anywhere.
   void SetDistortionLabel(REveText *t);
   void UpdateDistortionLabel();

   Int_t WriteCoreJson(nlohmann::json &j, Int_t rnr_offset) override;
   void BuildRenderData() override;
};

} // namespace Experimental
} // namespace ROOT

#endif
