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

   /// Evaluate streamed trajectories between updates, or hold each object where
   /// the last update put it. See REveElement::SetMotion and Motion.js.
   ///
   /// Per viewer and client-applied, like the axis settings: what it controls is
   /// how this viewer draws between updates, not what the server sends. Turning
   /// it off is how you see the raw update rate -- which is the thing to look at
   /// when the motion is wrong and you need to know whether it is the stream or
   /// the extrapolation.
   Bool_t fExtrapolateMotion{kTRUE};

   /// Which axis points up -- 0/1/2 for x/y/z, -1 for "no opinion", the default.
   ///
   /// The box axes draw the three faces pointing away from the camera, so the
   /// panels sit behind the scene rather than in front of it. That is right for
   /// a scene with no preferred direction, and wrong for one standing on a
   /// floor: from eye height inside a room the far face along up is the
   /// CEILING, so the floor -- the one surface you want ruled -- is the one not
   /// drawn.
   ///
   /// Naming the up axis makes that face always the minimum one. A floor is
   /// safe to draw even when it faces the camera, because the scene rests on
   /// top of it; a near side wall would cut across the view, which is what the
   /// back-face rule is there to prevent.
   ///
   /// Told, not inferred. REve's camera types encode it -- XOZ means y is up --
   /// but Axis3D deliberately measures rather than reading type names, so as not
   /// to carry a table that has to track the enum.
   Int_t fAxesUpAxis{-1};
   bool      fBlackBackground{false};

   /// How much the 3D axis labels shrink with distance, in [0, 1]. The client
   /// scales each label's screen offset by pow(w_ref / w, fAxesAtten): 0 keeps
   /// a constant pixel size at any distance, 1 shrinks exactly like geometry,
   /// and in between is the readable compromise. Like the look parameters
   /// below it is applied entirely on the client -- it is here so that every
   /// client of the viewer agrees on it and it survives a reload.
   ///
   /// It is not a perceptual scale: how much it reads depends on the scene's
   /// depth spread against the camera distance, so on a small scene viewed
   /// from outside even 1 is barely visible. Which is why the setter clamps to
   /// [-4, 8] rather than [0, 1]: 1 is the physically honest value, past it is
   /// exaggeration, and below 0 is inverse perspective with the far labels
   /// largest. Default 0, the safe look.
   Float_t   fAxesAtten{1.f};

   /// Label size for the 3D axis, as a fraction of viewport height -- the units
   /// ZText uses in every screen-space mode. Client-applied like fAxesAtten and
   /// here for the same reason. Unlike attenuation this one is baked into the
   /// glyph geometry, so a change costs a rebuild on the client; it is a knob to
   /// set, not one to drag continuously.
   Float_t   fAxesFontSize{0.015f};

   /// Label size for the hover tooltip, same units and same reasoning as
   /// fAxesFontSize. Separate from it because the two are read at different
   /// distances and for different lengths of time: an axis number is glanced at
   /// in passing, a tooltip is read.
   Float_t   fTooltipFontSize{0.012f};

   /// Opacity of the plate behind the tooltip and behind kept annotations, in
   /// [0, 1]. Unlike the font size this DOES reach annotations already placed:
   /// size is baked into their geometry and is part of what one is, where
   /// opacity is pure appearance and wanting it changed means wanting it
   /// changed everywhere.
   Float_t   fTooltipAlpha{0.85f};

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
   Float_t   fLightScale{0.85};
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

   /// Note the getters return the stored value; every one of these properties
   /// is applied on the client, so a getter says what the clients were told,
   /// not what any of them is currently showing.
   EAxesType GetAxesType() const { return fAxesType; }
   void SetAxesType(int);

   Bool_t GetExtrapolateMotion() const { return fExtrapolateMotion; }
   void   SetExtrapolateMotion(bool);

   Int_t GetAxesUpAxis() const { return fAxesUpAxis; }
   void  SetAxesUpAxis(int);

   bool GetBlackBackground() const { return fBlackBackground; }
   void SetBlackBackground(bool);

   Float_t GetAxesAtten() const { return fAxesAtten; }
   void SetAxesAtten(Float_t a);

   Float_t GetAxesFontSize() const { return fAxesFontSize; }
   void SetAxesFontSize(Float_t s);

   Float_t GetTooltipFontSize() const { return fTooltipFontSize; }
   void SetTooltipFontSize(Float_t s);

   Float_t GetTooltipAlpha() const { return fTooltipAlpha; }
   void SetTooltipAlpha(Float_t a);

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
