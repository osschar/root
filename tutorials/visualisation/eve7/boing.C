/// \file
/// \ingroup tutorial_eve_7
/// The Amiga Boing demo, server-side.
///
/// A checkered ball bounces above a floor, inside the 3D axis box. Everything
/// about it is driven from the server -- position, spin and the shadow -- and
/// every frame goes out as **one matrix per element**, under kCBTransBBox:
/// nothing is re-tessellated, nothing is rebuilt on the client, and no geometry
/// crosses the wire after the first frame.
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
#include <ROOT/REveBox.hxx>
#include <ROOT/REvePointSet.hxx>
#include <ROOT/REveViewer.hxx>
#include <ROOT/REveTrans.hxx>

#include <TTimer.h>
#include <TMath.h>

#include <chrono>

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

   Double_t fX{0}, fY{kBY - kR}, fZ{0};       // position; elastic, so fY is the apex
   Double_t fVx{34}, fVy{0}, fVz{21};         // velocity; fVy is the falling one
   Double_t fSpin{0};                         // angle about the ball's polar axis

   std::chrono::steady_clock::time_point fLast{std::chrono::steady_clock::now()};
   std::chrono::steady_clock::time_point fT0{std::chrono::steady_clock::now()};
   int fSent{0};

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
      : TTimer(ms, kTRUE), fBall(ball), fShadow(shadow)
   {}

   int GetSent() const { return fSent; }

   Bool_t Notify() override
   {
      // No congestion check here, deliberately. The manager holds changes back
      // when the clients have not finished with the previous round and flushes
      // them on the last acknowledgement -- and because a change carries current
      // state rather than a delta, and stamps coalesce per element, what finally
      // goes out is simply the newest position. So this may fire as fast as it
      // likes; the link decides how much of it is sent.
      ++fSent;

      // Integrate on the wall clock, not on the timer period: frames are
      // dropped, so the two are not the same, and using the period would slow
      // the ball down exactly when the link is congested.
      auto now = std::chrono::steady_clock::now();
      Double_t dt = std::chrono::duration<double>(now - fLast).count();
      fLast = now;
      // A long stall -- a tab in the background, a client reconnecting -- must
      // not teleport the ball through a wall.
      if (dt > 0.1) dt = 0.1;

      const Double_t fDt = dt;

      // Ticks, not rounds on the wire -- the manager decides how many of these
      // are actually streamed. Compare with the timer period to see whether the
      // event loop is keeping up with the timer.
      if (fSent % 100 == 0) {
         Double_t el = std::chrono::duration<double>(now - fT0).count();
         ::Info("boing", "%d ticks, %.1f/s over %.1f s", fSent, fSent / el, el);
      }

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
/// Eight points at the corners of the room, and nothing else.
///
/// The scene bounding box is computed once, from the elements as they stand at
/// load -- so without this the axis box would frame the floor plus wherever the
/// ball happened to be at that instant, which is not the room and not the same
/// twice. Marking the corners pins it exactly, and the ball is then free to be
/// anywhere.
///
/// This is Matevz's "inverted aquarium": rather than draw a box around the
/// scene to contain it, put something at the extremities and let the bounding
/// box be inflated from the inside. `Shell.cc` in mkFit does the same with four
/// jet cones at twice the tracker radius and transparency 90 -- which is also
/// why a sparse event there does not make the camera jump.
///
/// Left faintly visible rather than transparent: they read as the corners of
/// the room, and an invisible element is one nobody can find when it is wrong.

static REvePointSet *make_room_corners()
{
   auto ps = new REvePointSet("Room corners");
   ps->SetMarkerColor(kMagenta - 7);
   ps->SetMarkerSize(1);
   ps->SetPickable(kFALSE);

   for (int i = 0; i < 8; ++i)
      ps->SetNextPoint((i & 1) ? kBX : -kBX,
                       (i & 2) ? kBY : -kBY,
                       (i & 4) ? kBZ : -kBZ);
   return ps;
}

////////////////////////////////////////////////////////////////////////////////
/// The floor -- a slab, so the shadow has something to land on. Its top face is
/// flush with the plane the ball bounces off.

static REveBox *make_floor()
{
   auto b = new REveBox("Floor");
   // SetFillColor, not SetMainColor -- REveBox::WriteCoreJson streams
   // GetFillColor() under the "fMainColor" key and nothing else, so for this
   // class the main colour never reaches the client at all.
   //
   // Plain light grey. A tinted one is not worth reaching for: TColor::GetColor
   // snaps to a near-enough entry already in the table, so asking for a lilac
   // (216, 204, 232) here quietly yields colour 18, which is this grey.
   b->SetFillColor(18);
   b->SetPickable(kFALSE);

   const Float_t y1 = -kBY - 3, y2 = -kBY;

   // Corner order as in box.C: 0-3 on the low-z face, 4-7 on the high-z one,
   // each running (-x,-y) (-x,+y) (+x,+y) (+x,-y).
   b->SetVertex(0, -kBX, y1, -kBZ);   b->SetVertex(1, -kBX, y2, -kBZ);
   b->SetVertex(2,  kBX, y2, -kBZ);   b->SetVertex(3,  kBX, y1, -kBZ);
   b->SetVertex(4, -kBX, y1,  kBZ);   b->SetVertex(5, -kBX, y2,  kBZ);
   b->SetVertex(6,  kBX, y2,  kBZ);   b->SetVertex(7,  kBX, y1,  kBZ);

   return b;
}

void boing(Long_t period_ms = 40)
{
   auto eveMng = REveManager::Create();
   eveMng->AllowMultipleRemoteConnections(false, false);

   // The box axes frame the scene and carry the scale, which is what the room
   // grid used to do and did too loudly.
   eveMng->GetDefaultViewer()->SetAxesType(REveViewer::kAxesEdge);

   auto scene = eveMng->GetEventScene();

   scene->AddElement(make_room_corners());
   scene->AddElement(make_floor());

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
   // Opaque enough to read. At 55 it was a faint smudge: the surface is lit
   // like any other, so the specular lifts even a pure black off black, and
   // what is left after that has to carry the whole shadow.
   shadow->SetMainTransparency(20);
   shadow->SetPickable(kFALSE);
   scene->AddElement(shadow);

   eveMng->Show();

   (new Boinger(ball, shadow, period_ms))->TurnOn();
}
