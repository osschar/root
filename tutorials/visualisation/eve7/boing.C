/// \file
/// \ingroup tutorial_eve_7
/// The Amiga Boing demo, server-side.
///
/// A checkered ball bounces around a wireframe room. Everything about it is
/// driven from the server -- position, spin and the shadow -- and every frame
/// goes out as **one matrix per element**, under kCBTransBBox: nothing is
/// re-tessellated, nothing is rebuilt on the client, and no geometry crosses
/// the wire after the first frame.
///
/// The ball is a `REveSMorph`, ported from Gled's SMorph, with the original
/// `checker_8.png` from gled's Geom1 demos. Select it in the browser to get its
/// full parameter set in the editor: twist it, pinch it, shear it, cut it open
/// in theta and phi, or retile the texture, all while it is bouncing.
///
/// \macro_code
///
/// \author Matevz Tadel

#include <ROOT/REveManager.hxx>
#include <ROOT/REveScene.hxx>
#include <ROOT/REveSMorph.hxx>
#include <ROOT/REveStraightLineSet.hxx>
#include <ROOT/REveTrans.hxx>

#include <TTimer.h>
#include <TMath.h>

using namespace ROOT::Experimental;

// Room half-extents and ball radius. **Y is up**: that is the up axis of the
// default REve camera, so a scene built this way needs no camera setup to read
// correctly. (Verified rather than assumed -- with the default camera, world +Y
// projects straight up the screen, +Z to the right and +X down-left.)
const Float_t kBX = 40, kBY = 30, kBZ = 40;
const Float_t kR  = 8;

////////////////////////////////////////////////////////////////////////////////
/// The whole demo: integrate, then write two matrices.
///
/// Note what is NOT here -- no call that touches geometry, colour or any other
/// element property. SetTransMatrix() stamps kCBTransBBox, so each tick streams
/// sixteen numbers per element and the client displaces the objects it already
/// has. Run it at any rate you like; the cost per frame does not depend on how
/// finely the ball is tessellated.

class Boinger : public TTimer {
   REveSMorph *fBall{nullptr};
   REveSMorph *fShadow{nullptr};

   Double_t fX{0}, fY{20}, fZ{0};             // position; elastic, so fY is the apex
   Double_t fVx{34}, fVy{0}, fVz{21};         // velocity; fVy is the falling one
   Double_t fSpin{0};                         // angle about the ball's polar axis
   Double_t fDt;

   static constexpr Double_t kGrav = -160;    // units / s^2, along -y
   static constexpr Double_t kTilt = 0.30;    // polar axis tipped out of vertical
   static constexpr Double_t kSpinRate = 2.4; // rad / s

   /// Reflect off a wall, elastically. Perfectly elastic on purpose: with no
   /// loss the ball returns to the same height for ever, which is what the
   /// original did and what makes it a demo rather than a simulation.
   static void Bounce(Double_t &p, Double_t &v, Double_t lim)
   {
      if (p > lim)       { p = 2 * lim - p;  v = -TMath::Abs(v); }
      else if (p < -lim) { p = -2 * lim - p; v =  TMath::Abs(v); }
   }

public:
   Boinger(REveSMorph *ball, REveSMorph *shadow, Long_t ms)
      : TTimer(ms, kTRUE), fBall(ball), fShadow(shadow), fDt(ms * 1e-3)
   {}

   Bool_t Notify() override
   {
      fVy += kGrav * fDt;
      fX += fVx * fDt;  fY += fVy * fDt;  fZ += fVz * fDt;

      Bounce(fX, fVx, kBX - kR);
      Bounce(fY, fVy, kBY - kR);
      Bounce(fZ, fVz, kBZ - kR);

      fSpin += kSpinRate * fDt;

      // The ball spins about its own polar axis -- which for an SMorph is the
      // local x, not z -- and that axis is stood up near vertical and tipped
      // off it. It does not roll: the spin is constant and unrelated to the
      // motion, exactly as on the Amiga, and that is what makes it read as a
      // spinning ball rather than a rolling one.
      Double_t cs = TMath::Cos(fSpin), sn = TMath::Sin(fSpin);
      // Rotate the polar axis by a quarter turn to stand it up (x -> y), then
      // lean it over by kTilt.
      Double_t al = TMath::PiOver2() + kTilt;
      Double_t ct = TMath::Cos(al), st = TMath::Sin(al);

      // Columns of Rz(al) * Rx(spin), scaled to the radius.
      Double_t e1[3] = {  ct,       st,      0   };
      Double_t e2[3] = { -st * cs,  ct * cs, sn  };
      Double_t e3[3] = {  st * sn, -ct * sn, cs  };

      REveManager::ChangeGuard ch;

      REveTrans t;
      t.SetBaseVec(1, kR * e1[0], kR * e1[1], kR * e1[2]);
      t.SetBaseVec(2, kR * e2[0], kR * e2[1], kR * e2[2]);
      t.SetBaseVec(3, kR * e3[0], kR * e3[1], kR * e3[2]);
      t.SetPos(fX, fY, fZ);
      fBall->SetTransMatrix(t.Array());

      // The shadow, tightening as the ball comes down. Same mechanism, one more
      // matrix -- no second element type, no shadow pass, no light.
      //
      // It is a hemisphere (SetThetaMax(0.5)) squashed along its own polar axis
      // into a very shallow dome, NOT a flattened whole sphere. A whole one
      // squashed this far leaves its two halves a fraction of a unit apart in a
      // scene eighty units across, and they z-fight. A hemisphere has one
      // surface and cannot.
      //
      // That is also why the basis is set by hand rather than with SetScale:
      // the flattening has to be along the *polar* axis, which for an SMorph is
      // the local x, and that axis has to end up pointing at the ceiling.
      Double_t h = (fY + kBY) / (2 * kBY);        // 0 at the floor, 1 at the ceiling
      Double_t s = kR * (1.15 - 0.45 * h);
      REveTrans sh;
      sh.SetBaseVec(1, 0, 0.02 * kR, 0);          // polar axis up, and squashed
      sh.SetBaseVec(2, s, 0, 0);
      sh.SetBaseVec(3, 0, 0, s);
      sh.SetPos(fX, -kBY + 0.01 * kR, fZ);
      fShadow->SetTransMatrix(sh.Array());

      Reset();
      return kTRUE;
   }
};

////////////////////////////////////////////////////////////////////////////////
/// The room: a magenta cage with a grid on every face, in the spirit of the
/// original's backdrop. Static -- it is streamed once and never touched again.

static REveStraightLineSet *make_room(Int_t ndiv)
{
   auto ls = new REveStraightLineSet("Room");
   ls->SetMainColor(kMagenta);
   ls->SetLineWidth(1);
   // Scenery, not an object of interest: without this it highlights whenever
   // the pointer crosses any of its lines, which is most of the viewport.
   ls->SetPickable(kFALSE);

   const Float_t e[3] = {kBX, kBY, kBZ};

   // For each axis pair, rule both faces perpendicular to the third axis.
   for (Int_t ax = 0; ax < 3; ++ax) {
      Int_t a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
      for (Int_t side = 0; side < 2; ++side) {
         Float_t f = side ? e[ax] : -e[ax];
         for (Int_t i = 0; i <= ndiv; ++i) {
            Float_t u = -e[a1] + 2 * e[a1] * i / ndiv;
            Float_t p1[3], p2[3];
            p1[ax] = p2[ax] = f;
            p1[a1] = p2[a1] = u;
            p1[a2] = -e[a2]; p2[a2] = e[a2];
            ls->AddLine(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);

            Float_t v = -e[a2] + 2 * e[a2] * i / ndiv;
            Float_t q1[3], q2[3];
            q1[ax] = q2[ax] = f;
            q1[a2] = q2[a2] = v;
            q1[a1] = -e[a1]; q2[a1] = e[a1];
            ls->AddLine(q1[0], q1[1], q1[2], q2[0], q2[1], q2[2]);
         }
      }
   }
   return ls;
}

void boing(Long_t period_ms = 40)
{
   auto eveMng = REveManager::Create();
   eveMng->AllowMultipleRemoteConnections(false, false);

   auto scene = eveMng->GetEventScene();

   scene->AddElement(make_room(6));

   auto ball = new REveSMorph("Boing ball");
   ball->SetTLevel(32);
   ball->SetPLevel(48);
   ball->SetTexture("checker_8.png");
   ball->SetMainColor(kWhite);
   ball->SetPickable(kTRUE);
   // Size it before the first frame, or the unit-size surface shows at the
   // origin for the one tick before the timer first fires.
   ball->SetRadius(kR);
   scene->AddElement(ball);

   auto shadow = new REveSMorph("Shadow");
   shadow->SetTLevel(6);
   shadow->SetPLevel(32);
   shadow->SetThetaMax(0.5);      // a hemisphere -- see the comment in Notify()
   shadow->SetMainColor(kBlack);
   shadow->SetMainTransparency(55);
   shadow->SetPickable(kFALSE);
   scene->AddElement(shadow);

   eveMng->Show();

   (new Boinger(ball, shadow, period_ms))->TurnOn();
}
