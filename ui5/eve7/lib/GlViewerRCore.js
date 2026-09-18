sap.ui.define([
   'rootui5/eve7/lib/GlViewer',
   'rootui5/eve7/lib/EveElementsRCore',
   'rootui5/eve7/lib/Axis3D',
   'rootui5/eve7/lib/Annotations'
], function(GlViewer, EveElements, Axis3D, Annotations) {

   "use strict";

   let RC;
   let datGUI;

   class GlViewerRCore extends GlViewer {

      constructor(viewer_class)
      {
         super(viewer_class);

         const urlParams = new URLSearchParams(window.location.search);
         if (urlParams.get('RQ_ShaderDbg')) window.__RC_SHADERDBG = urlParams.get('RQ_ShaderDbg');

         let mode_mm = /^(?:Direct|Simple|Full)$/.exec(urlParams.get('RQ_Mode'));
         let ssaa_mm = /^(1|2|4)$/.               exec(urlParams.get('RQ_SSAA'));
         let marker_scale = /^([\d\.]+)$/.        exec(urlParams.get('RQ_MarkerScale'));
         let line_scale = /^([\d\.]+)$/.          exec(urlParams.get('RQ_LineScale'));

         // RQ_HdrStats=1 logs the dynamic range of the buffer feeding the final
         // pass once, to judge whether the tone curve is earning its keep.
         this.RQ_HdrStats = urlParams.get('RQ_HdrStats') == '1';

         // Tone curve of the final pass. "knee" passes ROOT colours through
         // unchanged below the knee and rolls highlights off smoothly above it;
         // "exposure" is the old 1-exp(-2c), which lightens the whole range;
         // "linear" clamps, which crushes lit surfaces that go over white.
         let tm_mm = /^(knee|exposure|linear)$/.exec(urlParams.get('RQ_ToneMap'));
         this.RQ_ToneMap = (tm_mm) ? tm_mm[0] : "knee";

         this.RQ_Mode = (mode_mm) ? mode_mm[0] : "Simple";
         this.RQ_SSAA = (ssaa_mm) ? ssaa_mm[0] : 2;
         this.RQ_MarkerScale = (marker_scale) ? marker_scale[0] : 1;
         this.RQ_LineScale   = (line_scale) ? line_scale[0] : 1;

         let jsrp = EVE.JSR.source_dir;
         // take out 'jsrootsys' and replace it with 'rootui5sys/eve7/'
         this.top_path = jsrp.substring(0, jsrp.length - 10);
         this.eve_path = this.top_path + 'rootui5sys/eve7/';

         this._logLevel = 3; // 0 - error, 1 - warning, 2 - info, 3 - debug

         if (this._logLevel > 2) {
            console.log("GlViewerRCore RQ_Mode:", this.RQ_Mode, "RQ_SSAA:", this.RQ_SSAA,
                        'RQ_MarkerScale', this.RQ_MarkerScale,  'RQ_LineScale', this.RQ_LineScale);
         }

         this._selection_map = {};
         this._selection_list = [];

         this.initialMouseX = 0;
         this.initialMouseY = 0;
         this.lastOffsetX = 0;
         this.lastOffsetY = 0;
         this.firstMouseDown = true;
         this.scale = false;
         this.pickedOverlayObj;
         this.initialSize = 0;
      }

      init(controller)
      {
         super.init(controller);

         let pthis = this;

         // For offline mode, one needs a a full URL or the request
         // gets forwarded to openi5.hana.ondemand.com.
         // This has to be understood and fixed. Loading of shaders
         // afterwards fails, too.
         // // console.log(window.location.pathname); // where are we loading from?
         // import("https://desire.physics.ucsd.edu/matevz/alja.github.io/rootui5/eve7/rnr_core/RenderCore.js").then((module) => {

         if (!RC) {
            import(this.eve_path + 'lib/RenderCore.js').then((module) => {
               if (this._logLevel >= 2)
                  console.log("GlViewerRCore.onInit - RenderCore.js loaded");
               RC = module;

               RC.Canvas.prototype.generateCanvasDOM = function(id="eve7-rc-canvas") {
                  if (RC.Canvas.prototype._xxcount === undefined) { RC.Canvas.prototype._xxcount = 0; }

                  const canvasDOM = document.createElement("canvas");
                  canvasDOM.id = id + "-" + RC.Canvas.prototype._xxcount;
                  ++RC.Canvas.prototype._xxcount;

                  //make it visually fill the positioned parent
                  //set the display size of the canvas
                  canvasDOM.style.width = "100%";
                  canvasDOM.style.height = "100%";
                  canvasDOM.style.padding = '0';
                  canvasDOM.style.margin = '0';

                  return canvasDOM;
               };

               pthis.ApplyTemporaryRCoreExtensions();

               pthis.bootstrap();
            });
         } else {
            this.bootstrap();
         }
      }

      bootstrap()
      {
         RC.GLManager.sCheckFrameBuffer = false;
         RC.Object3D.sDefaultQuaternionsAndAutoUpdate = false;
         RC.Mesh.sDefaultPickable = false;
         RC.PickingShaderMaterial.DEFAULT_PICK_MODE = RC.PickingShaderMaterial.PICK_MODE.UINT;

         this.createRCoreRenderer();

         this.creator = new EveElements(RC, this);
         // this.creator.useIndexAsIs = EVE.JSR.decodeUrl().has('useindx');
         if (this.RQ_Mode != "Direct") {
            this.creator.SetupPointLineFacs(this.RQ_SSAA,
                                            this.RQ_MarkerScale * this.canvas.pixelRatio,
                                            this.RQ_LineScale   * this.canvas.pixelRatio);
         }

         this.controller.createScenes();
         this.controller.redrawScenes();
         this.setupEventHandlers();
         this.updateViewerAttributes();

         this.controller.glViewerInitDone();

         let eveView = this.controller.mgr.GetElement(this.controller.eveViewerId);
         if (eveView.fSyncCam)
           this.syncCamTransTimer();
      }

      cleanup() {
         if (this.controller) this.controller.removeScenes();
         super.cleanup();
      }

      //==============================================================================

      make_object(name)
      {
         let c = new RC.Group();
         c.name = name || "<no-name>";
         return c;
      }

      get_top_scene()
      {
         return this.scene;
      }
      get_overlay_scene()
      {
         return this.overlay_scene;
      }

      //==============================================================================

      createRCoreRenderer()
      {
         let canvasParentDOM = document.createElement("div");
         let vid = this.get_view().sId + "--rcore";
         canvasParentDOM.setAttribute("id", vid);
         canvasParentDOM.style.width = "100%";

         // Height must be "what the toolbar left over", not 100%. This div is a
         // normal-flow sibling that follows the view's toolbar, so height:100%
         // made it as tall as the entire view while starting below the toolbar
         // -- overhanging the view's overflow:hidden edge by exactly the
         // toolbar's height. GL still rendered that strip, so anything drawn
         // hard against the bottom of the viewport was painted where the layout
         // never shows it. A projection axis is what exposed this, being the
         // only thing deliberately placed on the bottom edge.
         //
         // Done with flex rather than a computed pixel height so it needs no
         // measurement, survives a toolbar that changes size, and degrades to
         // the full height when there is no toolbar at all. min-height:0 is
         // required or the flex item refuses to shrink below its content.
         this.get_view().getDomRef().style.display = "flex";
         this.get_view().getDomRef().style.flexDirection = "column";
         canvasParentDOM.style.flex = "1 1 0";
         canvasParentDOM.style.minHeight = "0";

         // in case of openui5 rooter, the canvas element accumulates
         // destroy the old canvas element
	      let cn = this.get_view().getDomRef().childNodes;
         let oldCanvas = -1;
         for (let i =0; i < cn.length; ++i) {
           if (cn[i].id === vid)
                oldCanvas = i;
         }
         if (oldCanvas !== -1) {
            this.get_view().getDomRef().removeChild(cn[oldCanvas]);
         }

         this.get_view().getDomRef().appendChild(canvasParentDOM);
         this.canvas = new RC.Canvas(canvasParentDOM);
         let w = this.canvas.width;
         let h = this.canvas.height;
         this.fixCssSize();
         this.canvas.parentDOM.style.overflow = "hidden";
         this.canvas.canvasDOM.style.overflow = "hidden";
         // It seems SSAA of 2 is still beneficial on retina.
         // if (this.canvas.pixelRatio > 1 && this.RQ_SSAA > 1) {
         //    console.log("Correcting RQ_SSAA for pixelRatio", this.canvas.pixelRatio,
         //                "from", this.RQ_SSAA, "to", this.RQ_SSAA / this.canvas.pixelRatio);
         //    this.RQ_SSAA /= this.canvas.pixelRatio;
         // }

         // Stable handle for the browser console and for test harnesses. There is
         // otherwise no way to reach a viewer, its scene or its materials from
         // outside -- which is what makes things like setting a clipping plane by
         // hand awkward. Cheap, and in the same spirit as __RC_PICKDBG.
         (window.__RC_VIEWERS = window.__RC_VIEWERS || []).push(this);
         window.__RC = RC;   // the module itself, so RC.Vector3 & co. work in the console

         this.renderer = new RC.MeshRenderer(this.canvas, RC.WEBGL2,
                                             { antialias: false, stencil: false });
         this.renderer._logLevel = 0;
         this.renderer.addShaderLoaderUrls(this.eve_path + RC.REveShaderPath);
         this.renderer.pickObject3D = true;

         RC.Cache.enabled = true;
         this.tex_cache = new RC.TextureCache;

         // add dat GUI option to set background
         let eveView = this.controller.mgr.GetElement(this.controller.eveViewerId);
         if (eveView.BlackBg)
         {
            this.bgCol =  new RC.Color(0,0,0);
            this.fgCol = new RC.Color(1,1,1);
         }
         else
         {
            this.bgCol = new RC.Color(1,1,1);
            this.fgCol = new RC.Color(0,0,0);
         }

         // always use black clear color except in tone map
         this.renderer.clearColor = "#00000000";
         this.scene = new RC.Scene();
         this.overlay_scene = new RC.Scene();
         this.scene_bbox = new RC.Box3();

         this.lights = new RC.Group;
         this.lights.name = "Light container";
         this.scene.add(this.lights);

         this.createCameraAndLights();

         // The overlay is a fixed (0,0)-(1,1) screen box, so it needs its own
         // orthographic camera rather than the scene camera. Screen-mode ZText
         // maps VPos to clip space itself and ignores this, but any ordinary mesh
         // placed in the overlay -- GUI elements, frames, images -- needs it.
         //
         // NOTE for multi-user: this box is normalised, not aspect-corrected, so a
         // client with a different window ratio sees the same fractions of its own
         // viewport, not the same shape. ZText compensates by dividing x by the
         // aspect; plain meshes would need the same treatment, or the box would
         // have to move to NDC. Deliberately left as-is until we decide what
         // "the same overlay" should mean across screens of different ratios.
         this.overlay_camera = new RC.OrthographicCamera(0, 1, 1, 0, -1000, 1000);

         this.rqt = new RC.RendeQuTor(this.renderer, this.scene, this.camera,
                                      this.overlay_scene, this.overlay_camera);
         if (this.RQ_Mode == "Direct")
         {
            this.rqt.initDirectToScreen();
         }
         else if (this.RQ_Mode == "Simple")
         {
            this.rqt.initSimple(this.RQ_SSAA);
            this.rqt.set_tone_mapping(this.RQ_ToneMap);
         }
         else
         {
            this.rqt.initFull(this.RQ_SSAA);
         }
         this.rqt.updateViewport(w, h);


         // AMT secondary selection bug workaround for RenderCore PR #21
         this.rqt.pick_instance = function(state)
         {
            return this.pick_instance_low_level(this.pqueue, state);
         }
         this.rqt.pick_instance_overlay = function(state)
         {
            return this.pick_instance_low_level(this.ovlpqueue, state);
         }
      }

      createCameraAndLights()
      {
         let a_light = new RC.AmbientLight(new RC.Color(0xffffff), 0.05);
         this.lights.add(a_light);

         let light_3d_ctor = function(col, int, dist, decay, args) { return new RC.PointLight(col, int, dist, decay, args); };
         // let light_3d_ctor = function(col, int, dist, decay, args) { return new RC.DirectionalLight(col, int); };
         let light_2d_ctor = function(col, int) { return new RC.DirectionalLight(col, int); };

         // guides. The axis goes in the scene, not the overlay: it is 3D, and
         // the overlay has its own depth buffer and always draws in front,
         // which would put an axis line through the detector rather than
         // behind it.
         this.axis3d = new Axis3D(this, RC);
         this.scene.add(this.axis3d.group);

         // The hover tooltip and, later, annotations kept from it. Lives in the
         // overlay scene, so it is in the framebuffer and therefore in every
         // screen capture -- which the DOM tooltip it replaces never was.
         this.annotations = new Annotations(this, RC);

         let w = this.canvas.width;
         let h = this.canvas.height;

         if (this.controller.isEveCameraPerspective())
         {
            this.camera = new RC.PerspectiveCamera(75, w / h, 20, 4000);
            this.camera.isPerspectiveCamera = true;

            let l_int = 1.4;
            let l_args = { constant: 1, linear: 0, quadratic: 0, smap_size: 0 };
            this.lights.add(light_3d_ctor(0xaa8888, l_int, 0, 1, l_args)); // R
            this.lights.add(light_3d_ctor(0x88aa88, l_int, 0, 1, l_args)); // G
            this.lights.add(light_3d_ctor(0x8888aa, l_int, 0, 1, l_args)); // B
            this.lights.add(light_3d_ctor(0xaaaa66, l_int, 0, 1, l_args)); // Y
            this.lights.add(light_3d_ctor(0x666666, l_int, 0, 1, l_args)); // gray, bottom

            // Lights are positioned in positionCameraAndLights.

            // Markers on light positions (screws up bounding box / camera reset calculations)
            // for (let i = 1; i <= 4; ++i)
            // {
            //    let l = this.lights.children[i];
            //    l.add( new RC.IcoSphere(1, 1, 10.0, l.color.clone().multiplyScalar(0.5), false) );
            // }
         }
         else
         {
            this.camera = new RC.OrthographicCamera(-w/2, w/2, -h/2, h/2, 20, 2000);
            this.camera.isOrthographicCamera = true;

            let l_int = 0.85;
            this.lights.add(light_2d_ctor(0xffffff, l_int)); // white front
            // this.lights.add(light_2d_ctor(0xffffff, l_int)); // white back

            // Lights are positioned in positionCameraAndLights.
         }

         // AMT, disable auto update in camera in order prevent reading quaternions in update of
         // model view  matrix in Obejct3D function updateMatrixWorld
         this.camera.matrixAutoUpdate = false;

         // Test objects
         if (this.controller.isEveCameraPerspective())
         {
            // let c = new RC.Cube(40, new RC.Color(0.2,.4,.8));
            // c.material = new RC.MeshPhongMaterial();
            // c.material.transparent = true;
            // c.material.opacity = 0.8;
            // c.material.depthWrite  = false;
            // this.scene.add(c);

            // let ss = new RC.Stripe([0,0,0, 400,0,0, 400,400,0, 400,400,400]);
            // ss.material.lineWidth = 20.0;
            // ss.material.color     = new RC.Color(0xff0000);
            // ss.material.emissive  = new RC.Color(0x008080);
            // this.scene.add(ss);
         }

         this.rot_center = new RC.Vector3(0,0,0);
      }

      setupEventHandlers()
      {
         let dome = this.canvas.canvasDOM;

         // The tooltip used to be a div.eve_tooltip appended here. It is now a
         // ZText in the overlay scene (see Annotations), so that it is in the
         // framebuffer and therefore in screen captures, and so that it can
         // later be kept, moved and resized by the machinery every other
         // floating element already uses.


         // Setup some event pre-handlers
         let glc = this;

         dome.addEventListener('pointermove', function(event) {

            if (event.movementX == 0 && event.movementY == 0)
               return;

            glc.removeMouseupListener();

            if (event.buttons === 0 && event.srcElement === glc.canvas.canvasDOM) {
               glc.removeMouseMoveTimeout();
               glc.mousemove_timeout = setTimeout(glc.onMouseMoveTimeout.bind(glc, event.offsetX, event.offsetY), glc.controller.htimeout);
            } else {
               // glc.clearHighlight();
            }
         });

         dome.addEventListener('pointerleave', function() {
            glc.clearOverlayHover();

            glc.removeMouseMoveTimeout();
            glc.clearHighlight();
            glc.removeMouseupListener();
         });

         dome.addEventListener('pointerdown', function(event) {

            glc.removeMouseMoveTimeout();
            if (event.button != 0 && event.button != 2)  glc.clearHighlight();
            glc.removeMouseupListener();

            // console.log("GLC::mousedown", this, glc, event, event.offsetX, event.offsetY);

            glc.mouseup_listener = function(event2)
            {
               this.removeEventListener('pointerup', glc.mouseup_listener);

               if (event2.button == 0) // Selection on mouseup without move
               {
                  glc.handleMouseSelect(event2);
               }
               else if (event2.button == 2) // Context menu on delay without move
               {
                  EVE.JSR.createMenu(event2, glc).then(menu => glc.showContextMenu(event2, menu));
               }

            }

            this.addEventListener('pointerup', glc.mouseup_listener);
         });

         // Re-run the hover pick once a pointer interaction ends.
         //
         // Nothing else does: pointermove only arms the hover timeout while no
         // button is held, so after a rotation what sits under the cursor has
         // changed and nothing has noticed. It cannot live in mouseup_listener
         // either -- pointermove calls removeMouseupListener(), so that listener
         // survives only a click that never moved, which is precisely not a
         // drag. A plain pointerup handler is the one thing that always runs.
         //
         // At the END of the interaction, deliberately, never during it.
         // elementHighlighted() reaches the server through
         // elementSelectedSendMIR(), so re-picking while the camera moves would
         // send a MIR per frame as the scene sweeps under a stationary cursor.
         // The idle delay also means a drag that stops and immediately resumes
         // costs nothing at all.
         dome.addEventListener('pointerup', function(event) {
            glc.removeMouseMoveTimeout();
            glc.mousemove_timeout = setTimeout(
               glc.onMouseMoveTimeout.bind(glc, event.offsetX, event.offsetY),
               glc.controller.htimeout);
         });

         dome.addEventListener('dblclick', function() {
            //if (glc.controller.dblclick_action == "Reset")
            glc.positionCameraAndLights();
         });

         dome.addEventListener("mouseup", function() {
            glc.handleOverlayMouseUp();
         });

         dome.addEventListener("mousedown", function(event) {
            if (event.button == 0 || event.button == 2)
            {
               glc.handleOverlayMouseDown(event);

            }
         });

         dome.addEventListener("mousemove", function(event) {
            glc.handleOverlayMouseMove(event);
         });

         // Key-handlers go on window ...

         window.addEventListener('keydown', function(event) {
            // console.log("GLC::keydown", event.key, event.code, event);

            let handled = true;

            if (event.key == "t")
            {
               glc.scene.traverse( function( node ) {

                  if ( node.lineWidth )
                  {
                     if ( ! node.lineWidth_orig) node.lineWidth_orig = node.lineWidth;

                     node.lineWidth *= 1.2;
                  }
               });
            }
            else if (event.key == "e")
            {
               glc.scene.traverse( function( node ) {

                  if ( node.lineWidth )
                  {
                     if ( ! node.lineWidth_orig) node.lineWidth_orig = node.lineWidth;

                     node.lineWidth *= 0.8;
                  }
               });
            }
            else if (event.key == "r")
            {
               glc.scene.traverse( function( node ) {

                  if ( node.lineWidth && node.lineWidth_orig )
                  {
                     node.lineWidth = node.lineWidth_orig;
                  }
               });
            }
            else
            {
               handled = false;
            }

            if (handled)
            {
               // // // event.stopPropagation();
               // event.preventDefault();
               // event.stopImmediatePropagation();

               glc.render();
            }
         });

         // implement the camera control to client side (and look into how to locate the camera)
         this.controls = new RC.REveCameraControls(this.camera, this.canvas.canvasDOM);
         this.controls.addEventListener('change', this.render.bind(this));

         // sync camera trans to server after camera change have ended
         this.controls.addEventListener('end', function() {
            glc.controlsChanged = true;
         });

         // camera center marker
         let col = new RC.Color(0.5, 0, 0);
         const msize = this.RQ_SSAA * 8; // marker size
         let sm = new RC.ZSpriteBasicMaterial({
            SpriteMode: RC.SPRITE_SPACE_SCREEN, SpriteSize: [msize, msize],
            color: this.ColorBlack,
            emissive: col,
            diffuse: col.clone().multiplyScalar(0.5)
         }
         );
         let s = new RC.ZSprite(null, sm);
         s.instanced = false;
         s.visible = false;
         this.scene.add(s);
         this.centerMarker = s;

         // This will also call render().
         this.positionCameraAndLights();
      }

      syncCamTransTimer() {
         let glc = this;
         if (glc?.controlsChanged === true) {
            let equal = true;
            let a = glc.controls.getCamTrans().elements;
            let eveView = glc.controller.mgr.GetElement(this.controller.eveViewerId);
            let eveCamera = glc.controller.mgr.GetElement(eveView.fCameraId);
            let b = eveCamera.camTrans;

            // compare trans matrices
            for (let i = 0; i < 16; i++) {
               if (Math.abs(a[i] - b[i]) > 0.0000005) {
                  equal = false;
               }
            }

            // compare zoom if camera is orthographic
            if (glc.camera.isOrthographicCamera) {
               if (Math.abs(glc.camera.zoom - eveCamera.fZoom) > 0.0000005) {
                  eveCamera.fZoom = glc.camera.zoom;
                  equal = false;
               }
            }

            if (equal !== true) {
               // save trans matrix from orbit control to eve camera object
               for (let i = 0; i < 16; i++) {
                  b[i] = a[i];
               }

               // set trans matrix and zoom as array of 17 floats
               let sz = glc.camera.isOrthographicCamera === true ? glc.camera.zoom : 1;
               let fcall = "SetCamTransMtxStr(\"";
               fcall += b.join(",") + "," + sz + "\")";
               glc.controller.mgr.SendMIR(fcall, eveView.fCameraId,"ROOT::Experimental::REveCamera");
               glc.controlsChanged = false;
            }
         }
         setTimeout(this.syncCamTransTimer.bind(this), 5000);
      }

      recalcSceneBBox()
      {
         // The axis is built FROM the bounding box, so it must not contribute
         // TO it: its ticks reach past the box and every rebuild would push the
         // box further out. Its labels would be worse -- their vertices are
         // screen-space vec2, which expandByObject reads as 3D points at z=0.
         const ax = this.axis3d ? this.axis3d.group : null;
         if (ax) this.scene.remove(ax);
         this.scene_bbox.setFromObject( this.scene );
         if (ax) this.scene.add(ax);
         if (this.scene_bbox.isEmpty())
         {
            console.error("GlViewerRenderCore.positionCameraAndLights scene bbox empty", this.scene_bbox);
            const ext = 100;
            this.scene_bbox.expandByPoint(new RC.Vector3(-ext,-ext,-ext));
            this.scene_bbox.expandByPoint(new RC.Vector3( ext, ext, ext));
         }
         if (this.axis3d) this.axis3d.setBBox(this.scene_bbox);

         this.updateRenderBBox();
      }

      /** The box the camera's near and far planes are fitted to.
       *
       * Not scene_bbox: the axis is excluded from that one on purpose, since it
       * is built from it and would otherwise inflate itself every rebuild. But
       * the axis DRAWS ticks, numbers and names outside the box, and
       * optimizeNearFar fits the eight corners with 0.1% slack -- so anything
       * beyond them is clipped, and as the camera turns a different part of the
       * axis is beyond them. That is what decorations flickering in and out of
       * existence during a slow rotation actually is.
       *
       * Recomputed whenever either input can have changed: the scene extent, or
       * the axis style (which decides whether there is a margin at all). */
      updateRenderBBox()
      {
         this.render_bbox = this.scene_bbox.clone();
         if (this.axis3d) {
            const m = this.axis3d.getRenderMargin();
            if (m > 0) this.render_bbox.expandByScalar(m);
         }
      }

      positionCameraAndLights()
      {
         this.recalcSceneBBox();

         let sbbox = this.scene_bbox;
         let posV = new RC.Vector3; posV.subVectors(sbbox.max, this.rot_center);
         let negV = new RC.Vector3; negV.subVectors(sbbox.min, this.rot_center);

         let extV = new RC.Vector3; extV = negV; extV.negate(); extV.max(posV);
         let extR = extV.length();

         if (this._logLevel >= 2)
            console.log("GlViewerRenderCore.positionCameraAndLights", sbbox, posV, negV, extV, extR);

         let eveView = this.controller.mgr.GetElement(this.controller.eveViewerId);

         // Try to use standalone REveCamera if available
         let cameraId = eveView.fCameraId;

         let camera = this.controller.mgr.GetElement(cameraId);
         if (this._logLevel >= 2) {
            console.log("GlViewerRCore.positionCameraAndLights: Using standalone camera ID", cameraId);
            if (camera) {
               console.log("  Camera name:", camera.fName);
               console.log("  Camera camBase:", camera.camBase);
            }
         }

         let v1 = [camera.camBase[0], camera.camBase[1], camera.camBase[2]];   // forward/direction
         let v2 = [camera.camBase[8], camera.camBase[9], camera.camBase[10]];    // up

         if (this._logLevel >= 2) {
            console.log("GlViewerRCore.positionCameraAndLights: Using standalone REveCamera");
         }

         if (this.camera.isPerspectiveCamera)
         {
            this.controls.setCamBaseMtx(new RC.Vector3(v1[0], v1[1], v1[2]), new RC.Vector3(v2[0], v2[1], v2[2]));
            this.controls.screenSpacePanning = true;
            this.controls.enableRotate = true;

            let lc = this.lights.children;
            // lights are const now -- no need to set decay and distance
            lc[1].position.set( extR, extR, -extR);
            lc[2].position.set(-extR, extR,  extR);
            lc[3].position.set( extR, extR,  extR);
            lc[4].position.set(-extR, extR, -extR);
            lc[5].position.set(0, -extR, 0);
         }
         else
         {
            this.controls.setCamBaseMtx(new RC.Vector3(v1[0], v1[1], v1[2]), new RC.Vector3(v2[0], v2[1], v2[2]));
            let ey = 1.02 * extV.y;
            let ex = ey / this.get_height() * this.get_width();
            this.camera._left   = -ex;
            this.camera._right  =  ex;
            this.camera._top    =  ey;
            this.camera._bottom = -ey;
            this.camera.updateProjectionMatrix();

            if (typeof this.controls.resetOrthoPanZoom == 'function')
               this.controls.resetOrthoPanZoom();

            this.controls.screenSpacePanning = true;
            this.controls.enableRotate = false;

            let lc = this.lights.children;
            lc[1].position.set( 0, 0,  extR);
         }

         this.controls.setFromBBox(sbbox);

         // Apply saved camTrans (if initialized)
         if (camera.fInitialized) {
            // Apply camTrans after bbox setup
            this.controls.setCamTrans(camera.camTrans.slice());
         }

         if (this.camera.isOrthographicCamera && camera.fZoom !== 1) {
            this.camera.zoom = camera.fZoom;
            this.controls.zoomChanged = true;
            this.camera.updateProjectionMatrix();
         }

         this.controls.update();

         this.centerMarker.visible = false;
      }

      updateViewerAttributes() {
         let eveView = this.controller.mgr.GetElement(this.controller.eveViewerId);
         if (eveView.BlackBg) {
            this.fgCol = this.creator.ColorWhite;
            this.bgCol = this.creator.ColorBlack;
         }
         else {
            this.bgCol = this.creator.ColorWhite;
            this.fgCol = this.creator.ColorBlack;
         }

         this.applyRenderParams(eveView);
         this.recolourFgElements();

         // AxesType is REveViewer::EAxesType -- kAxesNone/kAxesOrigin/kAxesEdge.
         // Passed through whole rather than collapsed to a bool, so origin and
         // box styles can finally be told apart. Attenuation rides along as a
         // plain field: applied here, but held on the server so every client of
         // the viewer agrees and it survives a reload.
         // Font size before style: it is baked into the glyph geometry, so
         // setting it after a rebuild would throw that geometry away again.
         if (eveView.AxesFontSize !== undefined)
            this.axis3d.font_size = eveView.AxesFontSize;
         this.axis3d.setStyle(eveView.AxesType);
         if (eveView.AxesAtten !== undefined)
            this.axis3d.setAttenuation(eveView.AxesAtten);
         if (eveView.AxesFontSize !== undefined)
            this.axis3d.setFontSize(eveView.AxesFontSize);
         if (eveView.TooltipFontSize !== undefined && this.annotations)
            this.annotations.setFontSize(eveView.TooltipFontSize);
         if (eveView.TooltipAlpha !== undefined && this.annotations)
            this.annotations.setPlateAlpha(eveView.TooltipAlpha);
         // The axis style decides how far outside scene_bbox anything is drawn,
         // so the clip-plane box has to follow it -- not only the scene extent.
         this.updateRenderBBox();


         // compare cam base matrices
         let a = this.controls.getCamBase().elements;
         let eveCamera = this.controller.mgr.GetElement(eveView.fCameraId);

         // compare the base matrices
         let b = eveCamera.camBase;
         let equal = true;
         for (let i = 0; i < 16; i++) {
            if (Math.abs(a[i] - b[i]) > 0.0000005) {
               equal = false;
            }
         }

         // compare exisiting controller type and viewer's REveCamera type
         if (eveCamera.fType < 3) {
            if (this.controls?.isOrthographicCamera) {
               equal = false;
            }

         }
         else {
            if (this.controls?.isPerspectiveCamera) {
               equal = false;
            }
         }

         if (equal !== true) {
            this.lights.clear();
            delete this.camera;
            this.createCameraAndLights();
            this.positionCameraAndLights();
         }
         this.request_render();
      }


      //==============================================================================

      request_render(recalc_sbbox=false)
      {
         // console.log("REQUEST RENDER");

         this.render_requested_recalc_sbbox ||= recalc_sbbox;
         if (this.render_requested) return;
         setTimeout(this.render.bind(this), 0);
         this.render_requested = true;
      }

      render()
      {
         // console.log("RENDER", this.scene, this.camera, this.canvas, this.renderer);

         this.render_requested = false;
         this.updateOverlayPixelScale();
         this.updateProjectionAxes();
         // Annotation buttons hang off their box's laid-out rect, and a drag
         // moves that box through ovlSetPos without announcing it, so there is
         // nothing to hook -- re-place them per frame instead.
         if (this.annotations) this.annotations.layout();
         if (this.axis3d) this.axis3d.updateForCamera(this.camera);
         if (this.render_requested_recalc_sbbox) {
            this.recalcSceneBBox();
            this.render_requested_recalc_sbbox = false;
         }
         if (this.camera.isPerspectiveCamera) {
            this.camera.optimizeNearFar(this.render_bbox || this.scene_bbox);
         }

         if (this.canvas.width <= 0 || this.canvas.height <= 0) return;

         this.rqt.render_begin(true);

         // Render outlines for active selections.

         for (let sel_id of this._selection_list)
         {
            let sel_entry = this._selection_map[ sel_id ];

            let obj_list = this.rqt.RP_GBuffer.obj_list;
            // let instance_list = [];

            for (let el_idx in sel_entry)
            {
               let el_entry = sel_entry[ el_idx ];
               // take all geometry objects, then we have to treat them differently, depending on type.
               // and update world-matrix / check visibility
               // or setup secondary indices for sub-instance drawing

               if (el_entry.instance_object) {
                     // instance_list.push(el_entry.instance_object);
                     obj_list.push(el_entry.instance_object);
                     el_entry.instance_object.outlineMaterial.outline_instances_setup( el_entry.instance_sec_idcs );
               } else {
                  for (let geo of el_entry.geom) {
                     if (geo === undefined)
                        console.warning("Processing viewer selection, undefined object for element", this.mgr.GetElement(el_idx));
                     else
                        obj_list.push(geo);
                  }
               }
            }

            if (obj_list.length == 0)
               continue;

            // Extract edge color (note, root colors), width from selection object.
            let sel_object = this.get_manager().GetElement(sel_id);
            let c = this.creator.RcCol(sel_object.fVisibleEdgeColor);
            this.rqt.RP_Outline_mat.setUniform("edgeColor", [ 2*c.r, 2*c.g, 2*c.b, 1 ]);
            this.rqt.render_outline();

            // for (const obj of instance_list) {
            //    obj.outlineMaterial.outline_instances_reset();
            // }

            this.rqt.RP_GBuffer.obj_list = [];
         }

         this.rqt.render_main_and_blend_outline();

         // XXXX here add rendering of overlay, e.g.:
         if (this.rqt.queue.used_fail_count == 0 && this.overlay_scene.children.length > 0) {
            this.rqt.render_overlay_and_blend_it();
         }
         // YYYY Or, it might be better to render overlay after the tone-mapping.
         // Eventually, if only overlay changes, we don't need to render the base-scene but
         // only overlay and re-merge them. Need to keep base textures alive in RendeQuTor.
         // Note that rgt.render_end() releases all std textures.

         if (this.rqt.queue.used_fail_count == 0) {
            // Grab first: render_tone_map_to_screen() is the pass that composites
            // the background colour in and forces alpha to 1, so anything read
            // after it has an opaque background baked in.
            if (this._capture_request)
               this.rqt.render_tone_map_to_capture();

            // AMT: All render passes are drawn with the black bg
            //      except of the tone map render pass
            if (this.RQ_HdrStats) { this.RQ_HdrStats = false; this.rqt.hdr_stats(); }
            if (this._autotune_pending) { this._autotune_pending = false; this.autoTuneLights(); }

            this.renderer.clearColor = '#' +  this.bgCol.getHexString() + '00';
            this.rqt.render_tone_map_to_screen();
            this.renderer.clearColor = "#00000000";
         }

         this.rqt.render_end();

         if (this._capture_request)
            this.finishCapture();

         if (this.rqt.queue.used_fail_count > 0) {
            if (this._logLevel >= 2)
               console.log("GlViewerRCore render: not all programs compiled -- setting up render timer");
            setTimeout(this.render.bind(this), 200);
         }

         // if (this.controller.kind === "3D")
         //    window.requestAnimationFrame(this.render.bind(this));
      }

      //==============================================================================
      // Image capture
      //
      // The image is grabbed from RendeQuTor after tone mapping but before the
      // background colour is composited in, so it carries straight alpha and can
      // be placed over any backdrop later. Pixels come back in WebGL orientation
      // (bottom-left origin); the receiving service is expected to flip them.
      //==============================================================================

      /** Grab the next rendered frame. cfg.scale multiplies the screen viewport
       * (use the viewer's RQ_SSAA to get the full supersampled image).
       * Returns a Promise of { width, height, pixels, view_name }. */
      grabImage(cfg = {})
      {
         if (this._capture_request)
            return Promise.reject(new Error("GlViewerRCore.grabImage: a capture is already pending"));

         if (cfg.scale && cfg.scale != this.rqt.capture_scale)
            this.rqt.set_capture_scale(cfg.scale);

         return new Promise((resolve, reject) => {
            this._capture_request = { cfg, resolve, reject };
            this.request_render();
         });
      }

      /** Called from render() once the capture pass has run. */
      finishCapture()
      {
         let req = this._capture_request;
         this._capture_request = null;
         if (!req) return;

         try {
            let img = this.rqt.grab_image();
            if (!img) throw new Error("RendeQuTor.grab_image() returned null");

            let eveView = this.get_manager().GetElement(this.controller.eveViewerId);
            img.view_name = eveView ? eveView.fName : "unknown_view";
            req.resolve(img);
         } catch (e) {
            req.reject(e);
         }
      }

      /** Grab and POST to an image-gator style service. cfg: { url, event_id,
       * view_type, scale }. The buffer is sent raw; X-Flip-Y tells the service
       * the rows still need flipping. */
      grabAndPostImage(cfg = {})
      {
         const url = cfg.url || "http://localhost:3000/capture";

         return this.grabImage(cfg).then(img => {
            return fetch(url, {
               method: "POST",
               headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Width":      img.width.toString(),
                  "X-Height":     img.height.toString(),
                  "X-Event-ID":   String(cfg.event_id ?? "unknown_event"),
                  "X-View-Type":  String(cfg.view_type ?? img.view_name),
                  "X-Flip-Y":     "1"
               },
               body: img.pixels
            }).then(rsp => {
               if (!rsp.ok) throw new Error("capture POST failed: " + rsp.status + " " + rsp.statusText);
               if (this._logLevel >= 2)
                  console.log("GlViewerRCore: posted capture", img.width + "x" + img.height, "to", url);
               return rsp;
            });
         }).catch(e => {
            console.error("GlViewerRCore.grabAndPostImage failed:", e);
            throw e;
         });
      }

      render_for_picking(x, y, detect_depth)
      {
         // console.log("RENDER FOR PICKING", this.scene, this.camera, this.canvas, this.renderer);

         if (this.canvas.width <= 0 || this.canvas.height <= 0) return null;

         this.rqt.pick_begin(x, y);

         let state = this.rqt.pick(x, y, detect_depth);

         // console.log("pick state", state);

         if (state.object === null) {
            this.rqt.pick_end();
            return null;
         }

         let top_obj = state.object;
         while (top_obj.eve_el === undefined)
            top_obj = top_obj.parent;

         state.top_object = top_obj;
         state.eve_el = top_obj.eve_el;

         if (state.eve_el.fSecondarySelect)
            this.rqt.pick_instance(state);

         this.rqt.pick_end();

         state.w = this.canvas.width;
         state.h = this.canvas.height;
         state.mouse = new RC.Vector2( ((x + 0.5) / state.w) * 2 - 1,
                                      -((y + 0.5) / state.h) * 2 + 1 );

         let ctrl_obj = state.object;
         while (ctrl_obj.get_ctrl === undefined)
            ctrl_obj = ctrl_obj.parent;

         state.ctrl = ctrl_obj.get_ctrl(ctrl_obj, top_obj);
         return state;

      }

      render_for_Overlay_picking(x, y, detect_depth)
      {
         // console.log("RENDER FOR PICKING", this.scene, this.camera, this.canvas, this.renderer);

         if (this.canvas.width <= 0 || this.canvas.height <= 0) return null;

         this.rqt.pick_begin(x, y);

         let state_overlay = this.rqt.pick_overlay(x, y, detect_depth);

         if (state_overlay.object === null) {
            this.rqt.pick_end();
            return null;
         }

         // Walk up to the owning REve element -- but STOP at the root.
         //
         // Every overlay object used to be streamed from the server and so had
         // an eve_el somewhere above it, and this loop relied on that: it ran
         // off the top of the hierarchy and threw on null.parent for anything
         // else. Client-local overlay elements -- kept annotations and their
         // buttons -- have no eve_el at all and are exactly that case, so the
         // pick threw before handleOverlayMouseDown could set up a drag. That
         // is why they could not be moved or resized.
         let top_obj = state_overlay.object;
         while (top_obj && top_obj.eve_el === undefined)
            top_obj = top_obj.parent;

         state_overlay.top_object = top_obj || state_overlay.object;
         state_overlay.eve_el = top_obj ? top_obj.eve_el : undefined;

         if (state_overlay.eve_el && state_overlay.eve_el.fSecondarySelect)
            this.rqt.pick_instance_overlay(state_overlay);

         this.rqt.pick_end();

         state_overlay.w = this.canvas.width;
         state_overlay.h = this.canvas.height;
         state_overlay.mouse = new RC.Vector2( ((x + 0.5) / state_overlay.w) * 2 - 1,
                                      -((y + 0.5) / state_overlay.h) * 2 + 1 );

         // Same for the control: a client-local element has none, and needs
         // none -- dragging and resizing go through ovlGetPos/ovlSetPos.
         let ctrl_obj = state_overlay.object;
         while (ctrl_obj && ctrl_obj.get_ctrl === undefined)
            ctrl_obj = ctrl_obj.parent;

         state_overlay.ctrl = ctrl_obj
                            ? ctrl_obj.get_ctrl(ctrl_obj, state_overlay.top_object)
                            : null;
         return state_overlay;
      }

      //==============================================================================

      get selection_map() { return this._selection_map; }

      remove_selection_from_list(sid)
      {
         let idx = this._selection_list.indexOf(sid);
         if (idx >= 0)
            this._selection_list.splice(idx,1);
      }

      make_selection_last_in_list(sid)
      {
         this.remove_selection_from_list(sid);
         this._selection_list.push(sid);
      }

      //==============================================================================

      fixCssSize() {
         let s = this.canvas.canvasDOM.style;
         s.width  = this.canvas.canvasDOM.clientWidth  + "px";
         s.height = this.canvas.canvasDOM.clientHeight + "px";
      }

      floatCssSize() {
         let s = this.canvas.canvasDOM.style;
         s.width = "100%";
         s.height = "100%";
      }

      onResizeTimeout()
      {
         if ( ! this.canvas) {
            if (this._logLevel >= 2)
               console.log("GlViewerRCore onResizeTimeout -- canvas is not set yet.");
            return;
         }
         {
            let dome = this.get_view().getDomRef();

            let vid = this.get_view().sId + "--rcore";
            let hasCanvas = false;
            for (const child of dome.children) {
               if (child.id === vid) {
                  hasCanvas = true;
               }
            }

            if (hasCanvas === false)
            {
               dome.appendChild(this.canvas.parentDOM);
            }
         }
         this.floatCssSize();
         this.canvas.updateSize();
         let w = this.canvas.width;
         let h = this.canvas.height;
         //console.log("GlViewerRCore onResizeTimeout", w, h, "canvas=", this.canvas, this.canvas.width, this.canvas.height);

         this.camera.aspect = w / h;
         this.updateOverlayPixelScale();
         this.rqt.updateViewport(w, h);
         this.controls.update();

         this.render();

         this.fixCssSize();
      }


      //==============================================================================
      // RCore renderer event handlers etc.
      //==============================================================================

      //------------------------------------------------------------------------------
      // Highlight & Mouse move timeout handling
      //------------------------------------------------------------------------------

      clearHighlight()
      {
         if (this.highlighted_top_object)
         {
            this.highlighted_top_object.scene.clearHighlight(); // XXXX should go through manager
            this.highlighted_top_object = null;
            if (this.annotations) this.annotations.hideTooltip();
         }
      }

      removeMouseMoveTimeout()
      {
         if (this.mousemove_timeout)
         {
            clearTimeout(this.mousemove_timeout);
            delete this.mousemove_timeout;
         }
      }

      onMouseMoveTimeout(x, y)
      {
         delete this.mousemove_timeout;

         let pstate = this.render_for_picking(x * this.canvas.pixelRatio, y * this.canvas.pixelRatio, false);

         if ( ! pstate)
            return this.clearHighlight();

         let c = pstate.ctrl;
         let idx = c.extractIndex(pstate.instance);

         c.elementHighlighted(idx, null, pstate.object)

         if (this.highlighted_top_object !== pstate.top_object)
            this._ttip_text = (pstate.object && pstate.eve_el) ? c.getTooltipText(idx) : "";
         this.highlighted_top_object = pstate.top_object;

         // Position and edge-flipping now belong to the tooltip itself: it is a
         // ZText in the overlay scene, so it knows its own laid-out box and does
         // not need the DOM offset arithmetic this used to do against the view.
         this.annotations.showTooltip(this._ttip_text, x, y);
      }

      remoteToolTip(msg)
      {
         // Server-pushed text for the element already under the pointer. It
         // carries no position, so the tooltip keeps the one it has.
         this._ttip_text = msg;
         if (this.highlighted_top_object && this.annotations)
            this.annotations.updateText(msg);
      }

      /** Only the three.js viewer still needs this: its tooltip is a DOM div
       * positioned against the view, which is what these offsets are for. The
       * RCore tooltip is a ZText in the overlay scene and positions itself in
       * screen fractions, so it needs none of it. Kept because the method is
       * still reachable, not because this file uses it. */
      getRelativeOffsets(elem)
      {
         // Based on:
         // https://stackoverflow.com/questions/3000887/need-to-calculate-offsetright-in-javascript

         let r = { left: 0, right: 0, top:0, bottom: 0 };

         let parent = elem.offsetParent;

         while (parent && getComputedStyle(parent).position === 'relative')
         {
            r.top    += elem.offsetTop;
            r.left   += elem.offsetLeft;
            r.right  += parent.offsetWidth  - (elem.offsetLeft + elem.offsetWidth);
            r.bottom += parent.offsetHeight - (elem.offsetTop  + elem.offsetHeight);

            elem   = parent;
            parent = parent.offsetParent;
         }

         return r;
      }

      //------------------------------------------------------------------------------
      // Mouse button handlers, selection, context menu
      //------------------------------------------------------------------------------

      removeMouseupListener()
      {
         if (this.mouseup_listener)
         {
            this.canvas.canvasDOM.removeEventListener('pointerup', this.mouseup_listener);
            this.mouseup_listener = 0;
         }
      }

      showContextMenu(event, menu)
      {
         // console.log("GLC::showContextMenu", this, menu)

         // See js/modules/menu/menu.mjs createMenu(), menu.add()

         let x = event.offsetX * this.canvas.pixelRatio;
         let y = event.offsetY * this.canvas.pixelRatio;
         let pstate = this.render_for_picking(x, y, true);

         menu.add("header:Context Menu");

         if (pstate) {
            if (pstate.eve_el)
            menu.add("Browse to " + (pstate.eve_el.fName || "element"), pstate.eve_el.fElementId, this.controller.invokeBrowseOf.bind(this.controller));

            let data = { "p": pstate, "v": this, "cctrl": this.controls};
            menu.add("Set Camera Center", data, this.setCameraCenter.bind(data));

            // Built from THIS pick, not from the live hover tooltip.
            //
            // The tooltip is already gone by now: the menu's DOM opens over the
            // canvas, the canvas gets pointerleave, and that clears the
            // highlight and hides the tooltip -- so an entry gated on the
            // tooltip being visible could never be reached. This pick has
            // everything the tooltip had anyway, and depth besides.
            if (this.annotations) {
               const idx = pstate.ctrl ? pstate.ctrl.extractIndex(pstate.instance) : null;
               const txt = (pstate.ctrl && typeof pstate.ctrl.getTooltipText === "function")
                         ? pstate.ctrl.getTooltipText(idx) : "";
               if (txt) {
                  const d = { a: this.annotations, txt: txt,
                              ox: event.offsetX, oy: event.offsetY };
                  menu.add("Keep annotation", d,
                           function(q) { q.a.keepAt(q.txt, q.ox, q.oy); });
               }
            }
         }

         menu.add("Reset camera", this.resetCamera);

         if (RC.REveDevelMode) {
            menu.add("separator");
            menu.add("Show program names", 'names', this.showShaderJson);
            menu.add("Show programs", 'progs', this.showShaderJson);
         }

         menu.show(event);
      }

      // callback from popup "Re" menu
      resetCamera()
      {
         let eveView = this.controller.mgr.GetElement(this.controller.eveViewerId);
         let  eve_camera = this.controller.mgr.GetElement(eveView.fCameraId);
         eve_camera.fInitialized = false;
         this.positionCameraAndLights();
      }

      setCameraCenter(data)
      {
         let pthis = data.v;

         let fov_rad_half = pthis.camera.fov * 0.5 * (Math.PI/180);
         let ftan = Math.tan(fov_rad_half);
         let x = data.p.mouse.x * data.p.w / data.p.h * data.p.depth * ftan;
         let y = data.p.mouse.y * data.p.depth * ftan;
         let e = new RC.Vector4(-data.p.depth, x, y, 1);

         // console.log("picked point >>> ", x, y, data.p.depth);
         // console.log("picked camera vector ", e);
         // pthis.camera.testMtx.dump();

         e.applyMatrix4(pthis.camera.testMtx);
         // console.log("picked word view coordinates ", e);

         pthis.centerMarker.matrix.setPosition(e.x, e.y, e.z);
			pthis.centerMarker.matrixChanged();
			pthis.centerMarker.visible = true;

         pthis.controls.setCameraCenter(e.x, e.y, e.z);
         pthis.request_render();
      }

      handleMouseSelect(event)
      {
         // A press that landed on an overlay element belongs to the overlay.
         // pointerup runs before the compatibility mouseup that ends the overlay
         // drag, so ovl_drag is still set here -- without this, clicking an
         // overlay button would also clear the scene selection behind it.
         if (this.ovl_drag) return;

         let x = event.offsetX * this.canvas.pixelRatio;
         let y = event.offsetY * this.canvas.pixelRatio;
         let pstate = this.render_for_picking(x, y, false);

         if (pstate) {
            let c = pstate.ctrl;
            c.elementSelected(c.extractIndex(pstate.instance), event, pstate.object);
            // WHY ??? this.highlighted_scene = pstate.top_object.scene;
         } else {
            // XXXX HACK - handlersMIR senders should really be in the mgr

            this.controller.created_scenes[0].processElementSelected(null, [], event);
         }


      }

      //==============================================================================
      // Overlay interaction: move and resize
      //
      // Client-local by design -- nothing here sends a MIR, so dragging an overlay
      // element moves it on this screen only and other clients are untouched.
      // Making it shared later means turning the two mutations below (setOffset and
      // fontSize) into MIRs on the owning element.
      //==============================================================================

      /** Overlay coordinates: (0,0) bottom-left to (1,1) top-right, matching the
       * space ZText's `offset` uniform lives in. Canvas y grows downward. */
      overlayNormCoords(event)
      {
         let x = event.offsetX * this.canvas.pixelRatio;
         let y = event.offsetY * this.canvas.pixelRatio;
         return { px: x, py: y,
                  nx: x / this.canvas.width,
                  ny: 1.0 - y / this.canvas.height };
      }

      /** Which part of the element the cursor grabbed: the bottom-right corner
       * resizes, anywhere else moves. Right-drag resizes from anywhere. */
      overlayGrabZone(obj, nx, ny, button)
      {
         // NB: the right button is already the context menu, so resize is the
         // corner grip only.
         if (!obj.resizable) return "move";
         if (typeof obj.getScreenRect !== "function") return "move";

         let r = obj.getScreenRect(this.canvas.width / this.canvas.height);
         if (!r) return "move";

         // The element computed and drew its own grip square, so use that rather
         // than recomputing it here -- the sensitive area is then exactly what the
         // user can see, and the two cannot drift apart.
         let gx = r.grip_x, gy = r.grip_y;
         if (!(gx > 0) || !(gy > 0)) return "move";

         let xmax = Math.max(r.x0, r.x1), ymin = Math.min(r.y0, r.y1);
         if (nx > xmax - gx && ny < ymin + gy) return "resize";
         return "move";
      }

      /** Re-lay any projection axes for the current scene camera.
       *
       * The axis holds its ticks in projected coordinates; the scene camera is
       * orthographic in a 2D projected view, so the visible extent -- unprojected
       * NDC corners -- is all that is needed to place them. Cheap, local, and it
       * means zooming never round-trips to the server. Returns true if anything
       * was rebuilt. */
      updateProjectionAxes()
      {
         if (!this.overlay_scene || !this.camera) return false;

         let p0 = new RC.Vector3(-1, -1, 0).unproject(this.camera);
         let p1 = new RC.Vector3( 1,  1, 0).unproject(this.camera);
         let l = Math.min(p0.x, p1.x), r = Math.max(p0.x, p1.x);
         let b = Math.min(p0.y, p1.y), t = Math.max(p0.y, p1.y);
         let aspect = this.canvas.width / this.canvas.height;

         let rebuilt = false;
         this.overlay_scene.traverse(function (o) {
            if (o.type === "ZTextAxis" && o.updateForCamera(l, r, b, t, aspect))
               rebuilt = true;
         });
         return rebuilt;
      }

      /** ZText bakes its resize grip into the vertex buffer but wants a pixel
       * floor, so it needs to know how big a CSS pixel is in screen space.
       * Rebuild overlay text when the factor actually changes -- a window resize
       * or a display-scale change in system settings -- since the grip size is
       * already in the buffer. Only a handful of elements, on the (already
       * throttled) resize path. */
      updateOverlayPixelScale()
      {
         if (!this.canvas || !this.canvas.height) return;
         let f = (this.canvas.pixelRatio || 1) / this.canvas.height;
         if (f === this._px_to_screen) return;
         this._px_to_screen = f;

         // Per object, not on the class: several viewers of different sizes can
         // show the same kind of element, and a shared static would have them
         // overwriting each other.
         if (this.overlay_scene) {
            let W = this.canvas.width, H = this.canvas.height;
            this.overlay_scene.traverse(function (o) {
               if (typeof o.setPixelScale === "function") o.setPixelScale(f, W, H);
            });
         }
      }

      /** Which overlay element is under the cursor.
       *
       * Deliberately a rectangle test rather than the GPU picking path: overlay
       * elements are few and each knows its own screen rect, so hover costs
       * nothing and can run on every mouse move. Mouse-down still uses real
       * picking. Later in the traversal means drawn later, i.e. on top. */
      overlayHoverTest(nx, ny)
      {
         let aspect = this.canvas.width / this.canvas.height;
         let hit = null;
         this.overlay_scene.traverse(function (o) {
            if (!o.pickable || !o.visible || typeof o.getScreenRect !== "function") return;
            let r = o.getScreenRect(aspect);
            if (!r) return;
            if (nx >= Math.min(r.x0, r.x1) && nx <= Math.max(r.x0, r.x1) &&
                ny >= Math.min(r.y0, r.y1) && ny <= Math.max(r.y0, r.y1))
               hit = o;
         });
         return hit;
      }

      /** Enter/leave bookkeeping, in the spirit of TGLOverlayElement's
       * MouseEnter/MouseLeave: exactly one element is highlighted at a time. */
      updateOverlayHover(event)
      {
         if (this.ovl_drag) return; // a drag owns the element until mouse-up

         let c = this.overlayNormCoords(event);
         let hit = this.overlayHoverTest(c.nx, c.ny);
         if (hit === this.ovl_hover) return;

         if (this.ovl_hover && typeof this.ovl_hover.setHighlight === "function")
            this.ovl_hover.setHighlight(false);
         this.ovl_hover = hit;
         if (hit && typeof hit.setHighlight === "function")
            hit.setHighlight(true);

         this.request_render();
      }

      clearOverlayHover()
      {
         if (!this.ovl_hover) return;
         if (typeof this.ovl_hover.setHighlight === "function") this.ovl_hover.setHighlight(false);
         this.ovl_hover = null;
         this.request_render();
      }

      handleOverlayMouseDown(event)
      {
         if (this.ovl_drag) return false;

         let c = this.overlayNormCoords(event);

         // RCore-side pick diagnostics are gated on window.__RC_PICKDBG; see
         // MeshRenderer._renderPickableObjects.
         if (this._logLevel >= 3) window.__RC_PICKDBG = true;
         let pstate = this.render_for_Overlay_picking(c.px, c.py, false);
         window.__RC_PICKDBG = false;
         if (this._logLevel >= 3)
            console.log("overlay pick at " + c.px + "," + c.py +
                        " hit=" + (!!(pstate && pstate.object)));
         if (!pstate || !pstate.object) return false;

         let obj = pstate.object;
         if (typeof obj.ovlGetPos !== "function") return false;   // not a movable overlay element
         let rect = (typeof obj.getScreenRect === "function")
                  ? obj.getScreenRect(this.canvas.width / this.canvas.height) : null;

         this.ovl_drag = {
            obj:       obj,
            zone:      this.overlayGrabZone(obj, c.nx, c.ny, event.button),
            grab_nx:   c.nx,
            grab_ny:   c.ny,
            orig_x:    obj.ovlGetPos()[0],
            orig_y:    obj.ovlGetPos()[1],
            orig_size: obj.ovlGetSize(),
            // Resize anchors on the top-left corner. The reference width is
            // measured to the *click point*, not to the box edge, so the scale
            // is exactly 1 at the moment of grabbing and grows smoothly from
            // there -- clicking a few pixels inside the grip must not make the
            // box jump before it starts following the mouse.
            anchor_x:  rect ? Math.min(rect.x0, rect.x1) : 0,
            grab_w:    rect ? (c.nx - Math.min(rect.x0, rect.x1)) : 0,
            // A press that never travels far enough is a click, not a drag.
            // Overlay elements are movable, so a button cannot be recognised on
            // press -- only on release, once we know it stayed put.
            moved:     false
         };

         // Stop the orbit controls from also acting on this drag.
         this.controls.enablePan = false;
         this.controls.enableRotate = false;
         return true;
      }

      handleOverlayMouseMove(event)
      {
         let d = this.ovl_drag;
         if (!d) { this.updateOverlayHover(event); return; }

         let c = this.overlayNormCoords(event);

         if (Math.abs(c.nx - d.grab_nx) > GlViewerRCore.OVL_CLICK_SLOP ||
             Math.abs(c.ny - d.grab_ny) > GlViewerRCore.OVL_CLICK_SLOP)
            d.moved = true;

         if (d.zone === "move") {
            d.obj.ovlSetPos(d.orig_x + (c.nx - d.grab_nx),
                            d.orig_y + (c.ny - d.grab_ny));
         } else if (d.grab_w > 1e-4) {
            // Cursor distance from the anchor, relative to what it was when the
            // grip was grabbed: 1.0 at grab, then tracks the mouse smoothly.
            let f = (c.nx - d.anchor_x) / d.grab_w;
            d.obj.ovlSetSize(Math.max(d.orig_size * f, 1e-4));
         }

         this.request_render();
      }

      handleOverlayMouseUp()
      {
         if (!this.ovl_drag) return;

         if (!this.ovl_drag.moved) this.overlayClick(this.ovl_drag.obj);

         this.ovl_drag = null;
         this.controls.enablePan = true;
         this.controls.enableRotate = true;
         this.request_render();
      }

      /** Re-colour elements that follow the viewer's foreground colour.
       *
       * Chrome -- a projection axis, say -- has to stay legible when the
       * background flips, and the flip happens long after the object was built,
       * so the colour cannot simply be baked in at construction. */
      recolourFgElements()
      {
         let fg = this.fgCol;
         if (!fg) return;
         let recolour = (o) => { if (o.use_fg_color && typeof o.setColors === "function")
                                    o.setColors(fg, fg); };
         if (this.overlay_scene) this.overlay_scene.traverse(recolour);
         if (this.scene) this.scene.traverse(recolour);
      }

      /** Apply the viewer's look parameters: light scale and tone curve.
       *
       * The authored intensity of each light is remembered the first time it is
       * seen, and the scale is always applied to that -- scaling the current
       * value would compound on every viewer update. */
      applyRenderParams(eveView)
      {
         if (!eveView) return;

         let scale = (eveView.LightScale === undefined) ? 1.0 : eveView.LightScale;
         for (const l of this.lights.children) {
            if (l._rc_base_intensity === undefined) l._rc_base_intensity = l.intensity;
            l.intensity = l._rc_base_intensity * scale;
         }

         if (this.rqt) {
            if (eveView.ToneMapMode !== undefined) this.rqt.set_tone_mapping(eveView.ToneMapMode);
            if (eveView.ToneMapKnee !== undefined) this.rqt.set_tone_knee(eveView.ToneMapKnee);
         }

         // AutoTuneLights() on the server bumps this; the measurement can only
         // happen here, against a rendered buffer, so it is deferred to render().
         if (eveView.AutoTuneSerial !== undefined &&
             eveView.AutoTuneSerial !== this._autotune_serial) {
            this._autotune_serial = eveView.AutoTuneSerial;
            if (this._autotune_serial > 0) this._autotune_pending = true;
         }

         this.request_render();
      }

      /** Pick a light scale that puts the brightest channel just under white.
       *
       * Reported back through SetLightScale() rather than kept locally: the
       * parameter belongs to the viewer, so every client of it should agree, and
       * the value survives a reload. */
      autoTuneLights()
      {
         let st = this.rqt.hdr_stats();
         if (!st || !st.covered_px || !(st.max_channel > 0)) return;

         let eveView = this.controller.mgr.GetElement(this.controller.eveViewerId);
         let cur = (eveView && eveView.LightScale !== undefined) ? eveView.LightScale : 1.0;

         // Ambient is not scaled by the lights alone, so this is approximate --
         // aim just under white and let a second request refine it if needed.
         const target = 0.98;
         let next = cur * target / st.max_channel;
         next = Math.min(Math.max(next, 0.05), 8.0);

         console.log("autoTuneLights: max_channel", st.max_channel.toFixed(3),
                     "scale", cur.toFixed(3), "->", next.toFixed(3));
         this.controller.mgr.SendMIR("SetLightScale(" + next.toFixed(4) + ")",
                                     this.controller.eveViewerId,
                                     "ROOT::Experimental::REveViewer");
      }

      /** A click on an overlay element that carries a click action sends that MIR.
       *
       * Everything else the overlay does -- moving, resizing, hover -- is
       * client-local by design. A button is the deliberate exception: it exists
       * to change server state, so it goes through the normal MIR path and the
       * result comes back to every subscribed client, not just this viewer.
       *
       * The action is read off the streamed element rather than the RCore
       * object, so nothing in RenderCore needs to know that buttons exist. */
      overlayClick(obj)
      {
         // A local handler wins: annotation buttons act entirely on the client
         // and have no server element behind them, so there is no MIR to send.
         if (obj && typeof obj._ovl_click === "function") { obj._ovl_click(); return; }

         let el = obj ? obj.eve_el : null;
         if (!el || !el.fClickMir) return;

         let mgr = this.controller ? this.controller.mgr : null;
         if (!mgr) return;

         // fClickTargetId 0 means "this element"; anything else lets a button
         // drive an object it is not part of, which is the usual case.
         let tid = el.fClickTargetId || el.fElementId;
         let tgt = mgr.GetElement(tid);
         if (!tgt) {
            console.error("overlayClick: no element", tid, "for MIR", el.fClickMir);
            return;
         }
         mgr.SendMIR(el.fClickMir, tid, tgt._typename);
      }

      /** Hide/show overlay elements flagged exclude_from_capture. Used around the
       * grab so screen-only decoration stays out of exported images. */
      setOverlayCaptureHidden(hide)
      {
         let touched = [];
         this.overlay_scene.traverse(function (o) {
            if (o.exclude_from_capture) { o.visible = !hide; touched.push(o); }
         });
         return touched;
      }

      timeStampAttributesAndTextures() {
         try {
            this.renderer.glManager._textureManager.incrementTime();
            this.renderer.glManager._attributeManager.incrementTime();
         }
         catch (e) {
            console.error("Exception caught in timeStampAttributesAndTextures.", e);
         }
      }

      clearAttributesAndTextures() {
         try {
            let delta = 2;
            this.renderer.glManager._textureManager.deleteTextures(true, delta);
            this.renderer.glManager._attributeManager.deleteBuffers(true, delta);
         }
         catch (e) {
            console.error("Exception caught in clearAttributesAndTextures.", e);
         }
      }

      /** Click/drag threshold for overlay elements, as a fraction of the canvas
       * (nx/ny are 0..1), so roughly 3 px on a typical view. Small enough that
       * a deliberate drag is never mistaken for a click, large enough to absorb
       * the pointer jitter of an ordinary press. */
      static OVL_CLICK_SLOP = 0.004;

      static showShaderCount = 0;
      showShaderJson(arg)
      {
         let progs = RC.ShaderLoader.sAllPrograms;
         let json;
         if (arg == "names") {
            let names = [];
            for (const p of progs) names.push(p);
            json = JSON.stringify(names, null, 2);
         } else if (arg == "progs") {
            let shdrs = this.rqt.renderer._shaderLoader.resolvePrograms( progs );
            json = JSON.stringify(shdrs, null, 2);
         } else {
            json = "bad option '" + arg + "' to GlViewerRCore.showShaderJson";
         }

         let count = GlViewerRCore.showShaderCount++;
         let extra = count ? ("-" + count) : "";

         const win = window.open("", "rcore.programs.json");
         win.document.open();
         win.document.write(`<html>
<head>
   <title>programs.json</title>
   <script>function save() {
     let b = new Blob( [ \`${json}\` ], {type: 'application/json'});
     const a = document.createElement('a');
     a.href = URL.createObjectURL(b);
     a.download = document.getElementById("filename").value; // 'programs'; // filename to download
     a.click();
   }</script>
</head>
<body>
   <form name="myform">
      <input type="text" id="filename" name="Filename" value="programs${extra}">
      <input type="button" onClick="save();" value="Save">
   </form>
   <pre> ${json} </pre>
</body>
         </html>`);
         win.document.close();
      }

      //==============================================================================
      // Temporary RCore additions (to avoid updating of RCore.tgz)
      //==============================================================================

      ApplyTemporaryRCoreExtensions() {
         console.log("GlViewerRCore.ApplyTemporaryRCoreExtensions()");

         // E.g.:
         // if (RC.PerspectiveCamera.prototype.optimizeNearFar === undefined) {
         //    RC.PerspectiveCamera.prototype.optimizeNearFar = function(scene_bbox) {
         //       this.matrixWorldInverse.getInverse(this.matrixWorld);
         //       // .....
         //    };
         // }
      }

      //==============================================================================

   } // class GlViewerRCore

   return GlViewerRCore;
});
