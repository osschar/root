// @(#)root/eve7:$Id$
// Authors: Matevz Tadel & Alja Mrak-Tadel: 2006, 2007, 2018

/*************************************************************************
 * Copyright (C) 1995-2019, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT7_REveViewer
#define ROOT7_REveViewer

#include <ROOT/REveElement.hxx>
#include <ROOT/REveCamera.hxx> 

namespace ROOT {
namespace Experimental {

class REveScene;

////////////////////////////////////////////////////////////////////////////////
/// REveViewer
/// Reve representation of TGLViewer.
////////////////////////////////////////////////////////////////////////////////

class REveViewer : public REveElement
{
public:
   // set alias instead
   using ECameraType = REveCamera::ECameraType;
   
   // backward compatibility
   static constexpr ECameraType kCameraPerspXOZ   = REveCamera::kCameraPerspXOZ;
   static constexpr ECameraType kCameraPerspYOZ   = REveCamera::kCameraPerspYOZ;
   static constexpr ECameraType kCameraPerspXOY   = REveCamera::kCameraPerspXOY;
   static constexpr ECameraType kCameraOrthoXOY   = REveCamera::kCameraOrthoXOY;
   static constexpr ECameraType kCameraOrthoXOZ   = REveCamera::kCameraOrthoXOZ;
   static constexpr ECameraType kCameraOrthoZOY   = REveCamera::kCameraOrthoZOY;
   static constexpr ECameraType kCameraOrthoZOX   = REveCamera::kCameraOrthoZOX;
   static constexpr ECameraType kCameraOrthoXnOY  = REveCamera::kCameraOrthoXnOY;
   static constexpr ECameraType kCameraOrthoXnOZ  = REveCamera::kCameraOrthoXnOZ;
   static constexpr ECameraType kCameraOrthoZnOY  = REveCamera::kCameraOrthoZnOY;
   static constexpr ECameraType kCameraOrthoZnOX  = REveCamera::kCameraOrthoZnOX;

   enum EAxesType {
      kAxesNone,
      kAxesOrigin,
      kAxesEdge
   };

   /// Tone curve applied to the rendered buffer. Values match the shader.
   enum EToneMapMode {
      kToneReinhard = 0,
      kToneExposure = 1,
      kToneLinear   = 2,  ///< no curve; exact colours, but anything over 1 clips
      kToneKnee     = 3   ///< identity below the knee, smooth roll-off above
   };

private:
   REveViewer(const REveViewer&) = delete;
   REveViewer& operator=(const REveViewer&) = delete;

   REveCamera* fCamera{0};

   EAxesType fAxesType{kAxesNone};
   bool      fBlackBackground{false};

   /// Look of the render, per viewer. These reach the client as plain fields and
   /// are applied there; nothing about them needs a server round trip except
   /// that the value is shared, so every client of the viewer agrees.
   ///
   /// fLightScale multiplies whatever intensities the client's own light rig
   /// uses, so 1.0 reproduces the historical look. The default is below 1
   /// deliberately: the rig was tuned against a compositing bug that darkened
   /// everything translucent, and once that was fixed the lights were left
   /// pushing about a third of the image above white, where the tone curve
   /// flattens exactly the highlights that specular lives in.
   Float_t   fLightScale{0.65};
   Int_t     fToneMapMode{kToneKnee};
   Float_t   fToneMapKnee{0.95};
   /// Bumped by AutoTuneLights(); the client re-measures when it changes.
   Int_t     fAutoTuneSerial{0};

   bool fMandatory{true};
   std::string fPostStreamFlag;

   std::vector<REveCamera*> fCameraList;

   ROOT::Experimental::REveCamera* CreateCamera(ECameraType type);

   bool fSyncCamera{true};

public:
   REveViewer(const std::string &n="REveViewer", const std::string &t="");
   ~REveViewer() override;

   void Redraw(Bool_t resetCameras=kFALSE);

   virtual void AddScene(REveScene* scene);
   // XXX Missing RemoveScene() ????

   // Camera setters
   void SetCamera(ROOT::Experimental::REveCamera *cam);
   REveCamera* GetCamera() const { return fCamera;}
   void SetCameraByElementId(ElementId_t cameraId); // set camera via ElementID
   void SetCameraType(REveCamera::ECameraType type);

   void SyncCamera(bool s) {fSyncCamera = s;}
   bool GetSyncCamera() const {return fSyncCamera;}

   void SetAxesType(int);
   void SetBlackBackground(bool);

   Float_t GetLightScale() const { return fLightScale; }
   void SetLightScale(Float_t s);

   Int_t GetToneMapMode() const { return fToneMapMode; }
   void SetToneMapMode(Int_t m);

   Float_t GetToneMapKnee() const { return fToneMapKnee; }
   void SetToneMapKnee(Float_t k);

   /// Ask the clients to pick a light scale that keeps the brightest channel
   /// just below white. Only the client can do this -- the dynamic range is a
   /// property of the rendered buffer, which exists nowhere else -- so this
   /// just requests it, and the client reports its choice back through
   /// SetLightScale(), which then reaches every other client of this viewer.
   void AutoTuneLights();

   void DisconnectClient();
   void ConnectClient();

   void SetMandatory(bool x);
   bool GetMandatory() { return fMandatory; }

   void RemoveElementLocal(REveElement *el) override;
   void RemoveElementsLocal() override;
   Int_t WriteCoreJson(nlohmann::json &cj, Int_t rnr_offset) override;
};


////////////////////////////////////////////////////////////////////////////////
/// REveViewerList
/// List of Viewers providing common operations on REveViewer collections.
////////////////////////////////////////////////////////////////////////////////

class REveViewerList : public REveElement
{
private:
   REveViewerList(const REveViewerList&) = delete;
   REveViewerList& operator=(const REveViewerList&) = delete;

protected:
   Bool_t        fShowTooltip;

   Float_t       fBrightness;
   Bool_t        fUseLightColorSet;

public:
   REveViewerList(const std::string &n="REveViewerList", const std::string &t="");
   ~REveViewerList() override;

   void AddElement(REveElement* el) override;
   void RemoveElementLocal(REveElement* el) override;
   void RemoveElementsLocal() override;

   // --------------------------------

   virtual void Connect();
   virtual void Disconnect();

   void RepaintChangedViewers(Bool_t resetCameras, Bool_t dropLogicals);
   void RepaintAllViewers(Bool_t resetCameras, Bool_t dropLogicals);
   void DeleteAnnotations();

   void SceneDestructing(REveScene* scene);

   // --------------------------------

   Bool_t  GetShowTooltip()     const { return fShowTooltip; }
   void    SetShowTooltip(Bool_t x)   { fShowTooltip = x; }

   Float_t GetColorBrightness() const { return fBrightness; }
   void    SetColorBrightness(Float_t b);

   Bool_t  UseLightColorSet()   const { return fUseLightColorSet; }
   void    SwitchColorSet();
 //  Int_t WriteCoreJson(nlohmann::json &cj, Int_t rnr_offset) override;
};

} // namespace Experimental
} // namespace ROOT

#endif
