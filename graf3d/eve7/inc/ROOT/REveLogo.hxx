// @(#)root/eve7:$Id$
// Authors: Matevz Tadel & Alja Mrak-Tadel

/*************************************************************************
 * Copyright (C) 1995-2019, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT7_REveLogo
#define ROOT7_REveLogo

#include <ROOT/REveElement.hxx>

#include <string>

namespace ROOT {
namespace Experimental {

////////////////////////////////////////////////////////////////////////////////
/// REveLogo
///
/// A screen-space image for an overlay scene: an experiment logo, a watermark.
///
/// Rendered client-side as a RenderCore ZSprite in screen space, so the size is
/// in CSS pixels and stays constant as the camera moves, and the shape comes
/// from the image's own alpha rather than from the quad. Like other overlay
/// elements it can be moved, and resized from its corner grip, entirely in the
/// client -- nothing is sent back, so two people watching the same scene place
/// their logo independently.
///
/// The image is served from a directory registered once with SetImageDir(),
/// which maps it under "eve-images/" the same way REveText maps its SDF fonts.
/// The images themselves are not shipped with ROOT; point this at wherever the
/// experiment keeps them.
////////////////////////////////////////////////////////////////////////////////

class REveLogo : public REveElement
{
public:
   /// Where the image comes from.
   ///   kImageDir a directory registered with SetImageDir(), which is how an
   ///             experiment serves assets from its own tree. The default.
   ///   kTextures ui5/eve7/textures/, the ZSprite template textures shipped with
   ///             ROOT -- markers, not general artwork. Only useful if you
   ///             actually want one of those.
   ///   kRemote   an absolute URL the browser fetches itself; detected
   ///             automatically from the file string.
   enum EImageSource_e { kImageDir = 0, kTextures, kRemote };

private:
   REveLogo(const REveLogo &) = delete;
   REveLogo &operator=(const REveLogo &) = delete;

protected:
   std::string fFile;         ///< file name inside the registered image directory

   Float_t fPosX{0.06};       ///< position in the (0,1) overlay box; the image is centred on it
   Float_t fPosY{0.92};
   Float_t fSize{96};         ///< height in CSS pixels; width follows the image aspect
   Float_t fOpacity{0.8};     ///< resting opacity; the client brightens it on hover

   Bool_t fResizable{true};
   EImageSource_e fSource{kImageDir};

   static std::string sImageDir;

public:
   REveLogo(std::string_view file, const Text_t *n = "REveLogo", const Text_t *t = "");
   ~REveLogo() override {}

   /// True if the file is an absolute URL rather than a name in a served dir.
   static bool IsRemote(const std::string &f);

   /// Register the directory the images are served from. Must be called after
   /// REveManager::Create(), since it installs an HTTP location.
   static bool SetImageDir(std::string_view dir);
   static const std::string &GetImageDir() { return sImageDir; }

   /// Either a file name inside the registered image directory, or an absolute
   /// URL, which the client then fetches directly.
   ///
   /// A remote URL has three ways to fail, none of them ours, and all of them
   /// silent in the sense that the logo simply does not appear:
   ///   - CORS. The image is used as a WebGL texture, and texImage2D from a
   ///     cross-origin image throws unless the remote server sends
   ///     Access-Control-Allow-Origin. Merely being fetchable is not enough.
   ///   - Mixed content. An http:// image is blocked outright on an https page.
   ///   - Certificates. A self-signed or expired cert kills the fetch unless the
   ///     user has already accepted it in that browser.
   /// Old institutional document servers tend to fail all three. For anything
   /// that has to work, serve the file locally via SetImageDir().
   const std::string &GetFile() const { return fFile; }
   void SetFile(std::string_view f) { fFile = f; StampObjProps(); }

   Float_t GetPosX() const { return fPosX; }
   Float_t GetPosY() const { return fPosY; }
   void SetPosition(Float_t x, Float_t y) { fPosX = x; fPosY = y; StampObjProps(); }

   Float_t GetSize() const { return fSize; }
   void SetSize(Float_t s) { fSize = s; StampObjProps(); }

   Float_t GetOpacity() const { return fOpacity; }
   void SetOpacity(Float_t o) { fOpacity = o; StampObjProps(); }

   EImageSource_e GetSource() const { return fSource; }
   void SetSource(EImageSource_e s) { fSource = s; StampObjProps(); }

   Bool_t GetResizable() const { return fResizable; }
   void SetResizable(Bool_t r) { fResizable = r; StampObjProps(); }

   Int_t WriteCoreJson(nlohmann::json &j, Int_t rnr_offset) override;
   void BuildRenderData() override;
};

} // namespace Experimental
} // namespace ROOT

#endif
