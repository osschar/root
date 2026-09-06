// @(#)root/eve7:$Id$
// Author: Waad Alshehri, 2023

/*************************************************************************
 * Copyright (C) 1995-2019, Rene Brun and Fons Rademakers.               *
 * All rights reserved.                                                  *
 *                                                                       *
 * For the licensing terms see $ROOTSYS/LICENSE.                         *
 * For the list of contributors see $ROOTSYS/README/CREDITS.             *
 *************************************************************************/

#ifndef ROOT7_REveText
#define ROOT7_REveText

#include <ROOT/REveShape.hxx>
#include <ROOT/REveVector.hxx>

namespace ROOT {
namespace Experimental {

//------------------------------------------------------------------------------
// REveText
//------------------------------------------------------------------------------

class REveText : public REveShape
{
private:
   REveText(const REveText &) = delete;
   REveText &operator=(const REveText &) = delete;

protected:
   std::string fText {"<no-text>"};
   std::string fFont {"LiberationSans-Regular"};
   REveVector  fPosition {0, 0, 0};
   Float_t     fFontSize {80};
   Float_t     fFontHinting {1.0};
   Float_t     fExtraBorder {0.2}; // border around text in font-size units
   Int_t       fMode {1}; // default mode is in relative screen coordinates [0,1]
   Bool_t      fResizable {true}; // can the client resize it by dragging the corner grip
   Int_t       fAlignH {0};       // EAlignH_e: which point of the box the position refers to
   Int_t       fAlignV {0};       // EAlignV_e
   Color_t     fTextColor {kMagenta};
   // UChar_t     fTextAlpha {255}; // Better than main transparency -- to be fixed.

   static std::string sSdfFontDir;

   static bool SetDefaultSdfFontDir();

public:
   /// Anchoring: SetPosition() says where the text goes, these say which point of
   /// it lands there. Same model as TGLFont's ETextAlignH_e / ETextAlignV_e.
   /// kOrigin is the default and preserves the historical behaviour -- the
   /// position is the text origin (pen start), which sits a little inside the box
   /// because of the frame border. The others are relative to the box, which is
   /// what a tick label wants: kCenterH/kTop to hang under a horizontal axis,
   /// kRight/kCenterV against a vertical one.
   enum EAlignH_e { kOriginH = 0, kLeft, kCenterH, kRight };
   enum EAlignV_e { kOriginV = 0, kTop, kCenterV, kBottom };

   REveText(const Text_t *n = "REveText", const Text_t *t = "");
   virtual ~REveText() {}

    Int_t WriteCoreJson(nlohmann::json &j, Int_t rnr_offset) override;
   void BuildRenderData() override;

   void ComputeBBox() override;

   std::string GetText() const { return fText; }
   void SetText(std::string_view text) { fText = text; StampObjProps(); }

   std::string GetFont() const { return fFont; }
   void SetFont(std::string_view font) { fFont = font; StampObjProps();}

   Float_t GetFontSize() const { return fFontSize; }
   void SetFontSize(float size) { fFontSize = size; StampObjProps();}

   Int_t GetMode() const { return fMode; }
   void SetMode(Int_t mode) { fMode = mode;}

   /// Whether the client may resize this element by dragging its corner grip.
   /// Moving is governed by SetPickable(); a pickable element that is not
   /// resizable can be repositioned but keeps its size, which is what you want
   /// for a fixed-format label such as a run/event header.
   Bool_t GetResizable() const { return fResizable; }
   void SetResizable(Bool_t r) { fResizable = r; StampObjProps(); }

   Int_t GetAlignH() const { return fAlignH; }
   Int_t GetAlignV() const { return fAlignV; }
   void SetTextAlign(Int_t h, Int_t v) { fAlignH = h; fAlignV = v; StampObjProps(); }

   Float_t GetFontHinting() const { return fFontHinting; }
   void SetFontHinting(Float_t fontHinting) { fFontHinting = fontHinting; StampObjProps();}

   Float_t GetExtraBorder() const { return fExtraBorder; }
   void SetExtraBorder(float size) { fExtraBorder = size; StampObjProps();}

   REveVector GetPosition() const { return fPosition; }
   const REveVector& RefPosition() const { return fPosition; }
   void SetPosition(const REveVector& position) { fPosition = position;}
   void SetPosX(float x) { fPosition.fX = x; StampObjProps(); }
   void SetPosY(float y) { fPosition.fY = y; StampObjProps(); }

   Color_t GetTextColor() const { return fTextColor; }
   void SetTextColor(Color_t color) { fTextColor = color; StampObjProps();}

   // UChar_t GetTextAlpha() const { return fTextAlpha; }
   // void SetTextAlpha(UChar_t c) { fTextAlpha = c; StampObjProps(); }

   static bool SetSdfFontDir(std::string_view dir, bool require_write_access = true);
   static bool AssertSdfFont(std::string_view font_name, std::string_view ttf_font);
};

} // namespace Experimental
} // namespace ROOT

#endif
