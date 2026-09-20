/// \file
/// \ingroup tutorial_eve_7
/// The Amiga Boing demo, server-side.
///
/// A checkered ball bounces inside the 3D axis box, which rules its floor.
/// Everything about it is driven from the server -- position, spin, the shadow
/// -- and nothing is re-tessellated, nothing is rebuilt on the client, and no
/// geometry crosses the wire after the first frame.
///
/// The two halves of that are worth separating, because the demo uses one
/// without the other on purpose:
///
///   - A transformation-only change (kCBTransBBox and nothing else) leaves the
///     acknowledged round entirely and goes out on the motion channel: no
///     BeginChanges/EndChanges, no acknowledgement, nothing gated on it, and
///     the element tree and editor never hear of it. THE SHADOW USES ONLY THIS.
///     It is placed by a matrix per update and steps at whatever rate those
///     arrive.
///
///   - SetMotion() additionally says how a thing is MOVING -- velocity,
///     acceleration, angular velocity, and how long the trajectory may be
///     trusted. The client then evaluates it on its own frame clock and draws
///     smoothly between updates. ONLY THE BALL DOES THIS.
///
/// So the ball is smooth at the display rate however rarely the server runs,
/// and the shadow steps. That is deliberate: a shadow's exact position between
/// updates is not worth a trajectory, and having one element of each makes the
/// point that the cheap channel and the trajectory are independent -- an
/// element may use the first without the second.
///
/// The ball is a `REveSMorph`, ported from Gled's SMorph, with the original
/// `checker_8.png` from gled's Geom1 demos. Select it in the browser to get its
/// full parameter set in the editor: twist it, pinch it, shear it, cut it open
/// in theta and phi, or retile the texture, all while it is bouncing.
///
/// The viewer's Ged has a Motion panel, folded away at the bottom, with the
/// three knobs that govern all of the above: how often the stream is acted on,
/// how often the result is drawn, and whether anything is drawn between
/// updates.
///
/// \macro_code
///
/// \author Matevz Tadel

#include <ROOT/REveManager.hxx>
#include <ROOT/REveScene.hxx>
#include <ROOT/REveSMorph.hxx>
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

   /// How long until the ball next hits something, in seconds.
   ///
   /// This is what makes the extrapolation window meaningful: up to the bounce
   /// the trajectory is exact, and the bounce is the one discontinuity the
   /// client has no way of predicting. Walls are linear, the floor and ceiling
   /// parabolic.
   Double_t TimeToNextBounce() const
   {
      Double_t t = 1e9;

      auto linear = [&](Double_t p, Double_t v, Double_t lim) {
         if (v > 1e-9)       t = TMath::Min(t, ( lim - p) / v);
         else if (v < -1e-9) t = TMath::Min(t, (-lim - p) / v);
      };
      linear(fX, fVx, kBX - kR);
      linear(fZ, fVz, kBZ - kR);

      // y: solve 0.5*g*t^2 + v*t + (p - lim) = 0 for the next positive root,
      // against whichever of floor or ceiling it is heading for.
      const Double_t ylim = kBY - kR;
      for (Double_t lim : {ylim, -ylim}) {
         Double_t c = fY - lim, b = fVy, a = 0.5 * kGrav;
         Double_t disc = b * b - 4 * a * c;
         if (disc < 0) continue;
         Double_t sq = TMath::Sqrt(disc);
         for (Double_t r : {(-b + sq) / (2 * a), (-b - sq) / (2 * a)})
            if (r > 1e-6) t = TMath::Min(t, r);
      }

      // Never promise more than a short while regardless: the demo could be
      // stopped, or the ball's motion changed from the prompt.
      return TMath::Min(t, 2.0);
   }

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

      // Ticks, not rounds on the wire -- the manager decides how many of these
      // are actually streamed. Compare with the timer period to see whether the
      // event loop is keeping up with the timer.
      if (fSent % 100 == 0) {
         Double_t el = std::chrono::duration<double>(now - fT0).count();
         ::Info("boing", "%d ticks, %.1f/s over %.1f s", fSent, fSent / el, el);
      }

      // Integrate in small fixed sub-steps, NOT in one step of the whole
      // interval. The simulation must not depend on how often this is called.
      //
      // Found the hard way: run at 200 ms and a single step moves the ball
      // further than the room is high, so it passes clean through the floor and
      // the reflection `p = 2*lim - p` puts it back somewhere with more energy
      // than it had. Repeat, and the speed runs away -- the ball reached 336
      // units/s against a physical maximum near 118, and the symptom was a ball
      // stuck at the floor with a near-zero extrapolation window, which looks
      // nothing like an integration bug.
      //
      // This is exactly what streaming trajectories is supposed to separate:
      // simulate finely, send rarely.
      for (Double_t rem = dt; rem > 0; ) {
         const Double_t h = TMath::Min(rem, 0.005);
         rem -= h;

         fVy += kGrav * h;
         fX += fVx * h;  fY += fVy * h;  fZ += fVz * h;

         Bounce(fX, fVx, kBX - kR);
         Bounce(fY, fVy, kBY - kR);
         Bounce(fZ, fVz, kBZ - kR);

         fSpin += kSpinRate * h;
      }


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

      // Say how it is moving, not just where it is. The client evaluates the
      // trajectory on its own frame clock, so the ball is smooth at 60 fps
      // however rarely this runs -- and under constant gravity the second-order
      // form is the exact path, not a smoothing of it.
      //
      // The window is the time to the next bounce, which is the only thing the
      // client cannot see coming. Up to it the extrapolation is exact; past it
      // the ball simply stops, which is visible and honest, rather than
      // continuing through the floor.
      Float_t vel[3] = {(Float_t)fVx, (Float_t)fVy, (Float_t)fVz};
      Float_t acc[3] = {0.f, (Float_t)kGrav, 0.f};

      // Angular velocity in the WORLD frame: the ball turns about its own polar
      // axis, which after standing it up and leaning it over is e1. Without
      // this the flight is smooth and the spin jumps once per update, and the
      // two disagreeing is more distracting than neither being smooth.
      Float_t omega[3] = {(Float_t)(kSpinRate * e1[0]),
                          (Float_t)(kSpinRate * e1[1]),
                          (Float_t)(kSpinRate * e1[2])};

      fBall->SetMotion(vel, acc, omega, (Float_t)TimeToNextBounce());

      // The shadow, tightening as the ball comes down. One more matrix -- no
      // second element type, no shadow pass, no light.
      //
      // Note what it does NOT get: SetMotion(). It rides the same motion
      // channel as the ball, but declares no trajectory, so the client never
      // extrapolates it -- it steps to each new matrix as it arrives while the
      // ball flies smoothly between them. A shadow's position between updates
      // is not worth a trajectory, and it leaves one element of each kind in
      // the demo, which is the clearest way to show the two are separable.
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

      // Never wider than the ball. The ball's centre reaches kBX - kR, so a
      // shadow any larger than kR sticks out through the wall -- and because
      // the scene box is the union of what is in it, that is enough to drag the
      // axis box out with it every time the ball nears a corner.
      Double_t s = kR * (1.0 - 0.3 * h);

      REveTrans sh;
      sh.SetBaseVec(1, 0, 0.02 * kR, 0);          // polar axis up, and squashed
      sh.SetBaseVec(2, s, 0, 0);
      sh.SetBaseVec(3, 0, 0, s);
      // Sit so the *bounding box* bottom lands exactly on the floor, not 0.08
      // below it: REveSMorph's box is conservative and spans the whole sphere,
      // so half the squashed thickness hangs beneath the dome that is drawn.
      // Reaching below the floor would put it outside the declared room.
      sh.SetPos(fX, -kBY + 0.02 * kR, fZ);
      fShadow->SetTransMatrix(sh.Array());

      Reset();
      return kTRUE;
   }
};

void boing(Long_t period_ms = 40)
{
   auto eveMng = REveManager::Create();
   eveMng->AllowMultipleRemoteConnections(false, false);

   // The box axes frame the scene and carry the scale, which is what the room
   // grid used to do and did too loudly.
   auto viewer = eveMng->GetDefaultViewer();
   viewer->SetAxesType(REveViewer::kAxesEdge);
   // Y is up here, so the box axes rule the FLOOR rather than whichever face
   // happens to point away -- from eye height inside the room that would be the
   // ceiling, leaving the surface the ball bounces off unmarked.
   viewer->SetAxesUpAxis(1);
   // The axis spans the ROOM, not whatever the scene happens to hold. Without
   // this it would measure the ball and its shadow -- the room is nowhere
   // drawn, so there is nothing else to take it from.
   //
   // This is what retires the trick of putting something invisible at the
   // extremities to inflate the bounding box from inside: an eight-corner box
   // that existed only to be counted, which had to be kept in step with a
   // volume nobody had written down. Now it is written down.
   viewer->SetAxesBBox(-kBX, -kBY, -kBZ, kBX, kBY, kBZ);

   auto scene = eveMng->GetEventScene();


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
