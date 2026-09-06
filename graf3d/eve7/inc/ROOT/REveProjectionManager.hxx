// @(#)root/eve7:$Id$
// Authors: Matevz Tadel & Alja Mrak-Tadel: 2006, 2007

/*************************************************************************
 * Copyright (C) 1995-2019, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT7_REveProjectionManager
#define ROOT7_REveProjectionManager

#include <ROOT/REveElement.hxx>
#include <ROOT/REveProjections.hxx>
#include <TAttBBox.h>

namespace ROOT {
namespace Experimental {

////////////////////////////////////////////////////////////////////////////////
/// REveProjectionManager
/// Manager class for steering of projections and managing projected objects.
////////////////////////////////////////////////////////////////////////////////

class REveProjectionManager : public REveElement,
                              public REveAuntAsList,
                              public TAttBBox
{
private:
   REveProjectionManager(const REveProjectionManager &) = delete;
   REveProjectionManager &operator=(const REveProjectionManager &) = delete;

protected:
   REveProjection *fProjections[REveProjection::kPT_End];

   REveProjection *fProjection{nullptr};  // current projection
   REveVector      fCenter;               // center of distortion
   Float_t         fCurrentDepth{0.};     // z depth of object being projected

   List_t fDependentEls;                  // elements that depend on manager and need to be destroyed with it

   Bool_t fImportEmpty{kFALSE};           // import sub-trees with no projectable elements

   virtual Bool_t ShouldImport(REveElement *el);
   virtual void   UpdateDependentElements(REveElement *root);

public:
   REveProjectionManager(REveProjection::EPType_e type = REveProjection::kPT_Unknown);
   ~REveProjectionManager() override;

   void AddDependent(REveElement *el);
   void RemoveDependent(REveElement *el);

   void SetProjection(REveProjection::EPType_e type);
   REveProjection *GetProjection() { return fProjection; }

   virtual void UpdateName();

   /// Step the current projection's distortion and reproject. Public and in the
   /// dictionary because it is a MIR target -- the overlay's distortion buttons
   /// call it. It lives here rather than on the axis because the manager is what
   /// owns the projection; the axes are its nieces and are refreshed from here.
   ///
   /// Additive in units of 1e-4, matching the distortion * 1000 this class
   /// already reports in its own name, and clamped at zero: a negative
   /// distortion is not meaningful, and the projections divide by
   /// 1 + |x| * distortion.
   void BumpDistortion(Int_t steps);

   void SetCenter(Float_t x, Float_t y, Float_t z);
   REveVector &GetCenter() { return fCenter; }

   void SetCurrentDepth(Float_t d) { fCurrentDepth = d; }
   Float_t GetCurrentDepth() const { return fCurrentDepth; }

   void SetImportEmpty(Bool_t ie) { fImportEmpty = ie; }
   Bool_t GetImportEmpty() const { return fImportEmpty; }

   virtual REveElement *ImportElementsRecurse(REveElement *el, REveElement *parent);
   virtual REveElement *ImportElements(REveElement *el, REveElement *ext_list = nullptr);

   virtual REveElement *SubImportElements(REveElement *el, REveElement *proj_parent);
   virtual Int_t SubImportChildren(REveElement *el, REveElement *proj_parent);

   virtual void ProjectChildren();
   virtual void ProjectChildrenRecurse(REveElement *el);

   void ComputeBBox() override;
};

} // namespace Experimental
} // namespace ROOT

#endif
