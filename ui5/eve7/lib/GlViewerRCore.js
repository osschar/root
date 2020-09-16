sap.ui.define([
   'rootui5/eve7/lib/GlViewer',
   'rootui5/eve7/lib/EveElementsRCore'
], function(GlViewer, EveElements) {

   "use strict";

   function GlViewerRCore(viewer_class)
   {
      GlViewer.call(this, viewer_class);
   }

   var RC;

   GlViewerRCore.prototype = Object.assign(Object.create(GlViewer.prototype), {

      constructor: GlViewerRCore,

      init: function(controller)
      {
         GlViewer.prototype.init.call(this, controller);
         // super.init(controller);

         var pthis = this;

         // For offline mode, one needs a a full URL or the request
         // gets forwarded to openi5.hana.ondemand.com.
         // This has to be understood and fixed. Loading of shaders
         // afterwards fails, too.
         // // console.log(window.location.pathname); // where are we loading from?
         // import("https://desire.physics.ucsd.edu/matevz/alja.github.io/rootui5/eve7/rnr_core/RenderCore.js").then((module) => {

         import("../../eve7/rnr_core/RenderCore.js").then((module) => {
            console.log("GlViewerRCore.onInit - RenderCore.js loaded");

            RC = module;

            pthis.bootstrap();
         });
      },

      bootstrap: function()
      {
         this.creator = new EveElements(RC);
         // this.creator.useIndexAsIs = (JSROOT.GetUrlOption('useindx') !== null);

         this.createRCoreRenderer();
         this.controller.createScenes();
         this.controller.redrawScenes();
         this.setupRCoreDomAndEventHandlers();

         this.controller.glViewerInitDone();

         // XXXX MT: HACK ... give RCore some time to load shaders.
         // Would be better to have some onShadersLoaded thing but
         // this is probably problematic later on,k if we add objects with
         // custom shaders later on.
         setTimeout(this.render.bind(this), 500);
      },

      //==============================================================================

      make_object: function(name)
      {
         let c = new RC.Group();
         c.name = name || "<no-name>";
         return c;
      },

      get_top_scene: function()
      {
         return this.scene;
      },

      //==============================================================================

      createRCoreRenderer: function()
      {
         var w = this.get_width();
         var h = this.get_height();

         //this.canvas = document.createElementNS( 'http://www.w3.org/1999/xhtml', 'canvas' );
         this.canvas = document.createElement('canvas');
         this.canvas.width  = w;
         this.canvas.height = h;

         this.renderer = new RC.MeshRenderer(this.canvas, RC.WEBGL2);
         this.renderer.clearColor = "#FFFFFFFF";
         this.renderer.addShaderLoaderUrls("rootui5sys/eve7/rnr_core/shaders");

         this.scene = new RC.Scene();

         this.lights = this.make_object("Light container");
         this.scene.add(this.lights);

         let a_light = new RC.AmbientLight(new RC.Color(0xffffff), 0.1);
         this.lights.add(a_light);

         let light_class_3d = RC.PointLight; // RC.DirectionalLight; // RC.PointLight;
         let light_class_2d = RC.DirectionalLight;

         if (this.controller.kind === "3D")
         {
            this.camera = new RC.PerspectiveCamera(75, w / h, 1, 5000);
            this.camera.position = new RC.Vector3(-500, 0, 0);
            this.camera.lookAt(new RC.Vector3(0, 0, 0), new RC.Vector3(0, 1, 0));
            this.camera.isPerspectiveCamera = true;

            let l_int = 0.85;
            this.lights.add(new light_class_3d(0xaa8888, l_int )); // R
            this.lights.add(new light_class_3d(0x88aa88, l_int )); // G
            this.lights.add(new light_class_3d(0x8888aa, l_int )); // B
            this.lights.add(new light_class_3d(0x999999, l_int )); // gray

            // Lights are positioned in resetRenderer.

            for (let i = 1; i <= 4; ++i)
            {
               let l = this.lights.children[i];
               l.add( new RC.IcoSphere(1, 1, 10.0, l.color.clone().multiplyScalar(0.5), false) );
            }
         }
         else
         {
            this.camera = new RC.OrthographicCamera(-w/2, w/2, -h/2, h/2, 0, 2000);
            this.camera.position = new RC.Vector3(0, 0, 500);
            this.camera.lookAt(new RC.Vector3(0, 0, 0), new RC.Vector3(0, 1, 0));
            this.camera.isOrthographicCamera = true;

            this.lights.add(new light_class_2d( 0xffffff, 1 )); // white front
            this.lights.add(new light_class_2d( 0xffffff, 1 )); // white back

            // Lights are positioned in resetRenderer.
         }

         // Test objects
         if (this.controller.kind === "3D")
         {
            /*
              let c = new RC.Cube(100, new RC.Color(1,.6,.2));
              c.material = new RC.MeshPhongMaterial();
              c.material.transparent = true;
              c.material.opacity = 0.5;
              c.material.depthWrite  = false;
              this.scene.add(c);
            */

            let ss = new RC.Stripe([0,0,0, 100,50,50, 100,200,200]);
            ss.material.lineWidth = 20.0;
            ss.material.color     = new RC.Color(0xff0000);
            this.scene.add(ss);
         }

         this.rot_center = new THREE.Vector3(0,0,0);
      },

      setupRCoreDomAndEventHandlers: function()
      {
         let dome = this.get_view().getDomRef();

         dome.appendChild(this.canvas);

         this.controls = new RC.ReveCameraControls(this.camera, this.get_view().getDomRef());

         this.controls.addEventListener('change', this.render.bind(this));

         // Setup some event pre-handlers
         var glc = this;

         dome.addEventListener('mousemove', function(event) {

            if (event.movementX == 0 && event.movementY == 0)
               return;

            glc.removeMouseupListener();

            if (event.buttons === 0) {
               glc.removeMouseMoveTimeout();
               glc.mousemove_timeout = setTimeout(glc.onMouseMoveTimeout.bind(glc, event.offsetX, event.offsetY), glc.controller.htimeout);
            } else {
               glc.clearHighlight();
            }
         });

         dome.addEventListener('mouseleave', function(event) {

            glc.removeMouseMoveTimeout();
            glc.clearHighlight();
            glc.removeMouseupListener();
         });

         dome.addEventListener('mousedown', function(event) {

            glc.removeMouseMoveTimeout();
            if (event.buttons != 1 && event.buttons != 2)  glc.clearHighlight();
            glc.removeMouseupListener();

            // console.log("GLC::mousedown", this, glc, event, event.offsetX, event.offsetY);

            glc.mouseup_listener = function(event2)
            {
               this.removeEventListener('mouseup', glc.mouseup_listener);

               if (event.buttons == 1) // Selection on mouseup without move
               {
                  glc.handleMouseSelect(event2);
               }
               else if (event.buttons == 2) // Context menu on delay without move
               {
                  // Was needed for "on press with timeout"
                  // glc.controls.resetMouseDown(event);

                  JSROOT.Painter.createMenu(glc, glc.showContextMenu.bind(glc, event2));
               }
            }

            this.addEventListener('mouseup', glc.mouseup_listener);
         });

         dome.addEventListener('dblclick', function(event) {
            //if (glc.controller.dblclick_action == "Reset")
            glc.resetRenderer();
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

         // This will also call render().
         this.resetRenderer();
      },

      resetRenderer: function()
      {
         let sbbox = new RC.Box3();
         sbbox.setFromObject( this.scene );
         if (sbbox.isEmpty())
         {
            console.error("GlViewerRenderCore.resetRenderer scene bbox empty", sbbox);
            const ext = 100;
            sbbox.expandByPoint(new RC.Vector3(-ext,-ext,-ext));
            sbbox.expandByPoint(new RC.Vector3( ext, ext, ext));
         }

         let posV = new RC.Vector3; posV.subVectors(sbbox.max, this.rot_center);
         let negV = new RC.Vector3; negV.subVectors(sbbox.min, this.rot_center);

         let extV = new RC.Vector3; extV = negV; extV.negate(); extV.max(posV);
         let extR = extV.length();

         console.log("GlViewerRenderCore.resetRenderer", sbbox, posV, negV, extV, extR);

         if (this.controller.kind === "3D") // (this.camera.isPerspectiveCamera)
         {
            let posC = new RC.Vector3(-0.7 * extR, 0.5 * extR, -0.7 * extR);

            this.camera.position.copy(posC);
            this.camera.lookAt(new RC.Vector3(0,0,0), new RC.Vector3(0,1,0));

            this.controls.screenSpacePanning = true;

            let lc = this.lights.children;
            lc[1].position.set( extR, extR, -extR); lc[1].decay = 4 * extR;
            lc[2].position.set(-extR, extR,  extR); lc[2].decay = 4 * extR;
            lc[3].position.set( extR, extR,  extR); lc[3].decay = 4 * extR;
            lc[4].position.set(-extR, extR, -extR); lc[4].decay = 4 * extR;

            // console.log("resetThreejsRenderer 3D scene bbox ", sbbox, ", camera_pos ", posC, ", look_at ", this.rot_center);
         }
         else
         {
            let posC = new RC.Vector3(0, 0, extR);

            this.camera.position.copy(posC);

            let ey = 1.02 * extV.y;
            let ex = ey / this.get_height() * this.get_width();
            this.camera._left   = -ex;
            this.camera._right  =  ex;
            this.camera._top    =  ey;
            this.camera._bottom = -ey;
            this.camera.updateProjectionMatrix();

            this.controls.resetOrthoPanZoom();

            this.controls.screenSpacePanning = true;
            this.controls.enableRotate = false;

            let lc = this.lights.children;
            lc[1].position.set( 0, 0,  extR);
            lc[2].position.set( 0, 0, -extR);

            // console.log("resetThreejsRenderer 2D scene bbox ex ey", sbbox, ex, ey, ", camera_pos ", posC, ", look_at ", this.rot_center);
         }
         this.controls.target.copy( this.rot_center );

         // this.composer.reset();

         this.controls.update();
      },

      //==============================================================================

      render: function()
      {
         // console.log("RENDER", this.scene, this.camera, this.canvas, this.renderer);
         this.renderer.render( this.scene, this.camera );
      },

      //==============================================================================

      onResizeTimeout: function()
      {
         let w = this.get_width();
         let h = this.get_height();

         //console.log("GlViewerRCore onResizeTimeout", w, h, "canvas=", this.canvas, this.canvas.width, this.canvas.height);

         this.canvas.width  = w;
         this.canvas.height = h;

         this.camera.aspect = w / h;

         this.renderer.updateViewport(w, h);

         //this.outline_pass.setSize(w, h);
         //this.fxaa_pass.uniforms.resolution.value.set(0.5 / w, 0.5 / h);

         //this.composer.reset();

         this.controls.update();
         this.render();
      },


      //==============================================================================
      // RCore renderer event handlers etc.
      //==============================================================================

      //------------------------------------------------------------------------------
      // Highlight & Mouse move timeout handling
      //------------------------------------------------------------------------------

      clearHighlight: function()
      {
         if (this.highlighted_scene)
         {
            this.highlighted_scene.clearHighlight(); // XXXX should go through manager
            this.highlighted_scene = 0;

            this.ttip.style.display = "none";
         }
      },

      removeMouseMoveTimeout: function()
      {
         if (this.mousemove_timeout)
         {
            clearTimeout(this.mousemove_timeout);
            delete this.mousemove_timeout;
         }
      },

      /** Get three.js intersect object at specified mouse position */
      getIntersectAt: function(x, y)
      {
         let w = this.get_width();
         let h = this.get_height();

         console.log("GLC::onMouseMoveTimeout", this, event, x, y);

         var pthis = this;
         this.renderer.pick(x, y, function(id)
                            {
                               let obj = pthis.get_manager().GetElement(id);
                               // As things are now, depth can not be known.
                               // Render to FBO or texture would work.
                               // let d   = pthis.renderer.pickedDepth;
                               console.log("pick result", id, obj /* , d */);
                            }
                           );
         this.render();
         /*
         let mouse = new THREE.Vector2( ((x + 0.5) / w) * 2 - 1, -((y + 0.5) / h) * 2 + 1 );

         this.raycaster.setFromCamera(mouse, this.camera);

         let intersects = this.raycaster.intersectObjects(this.scene.children, true);

         let o = null, c = null;

         for (let i = 0; i < intersects.length; ++i)
         {
            if (intersects[i].object.get_ctrl)
            {
               intersects[i].mouse = mouse;
               intersects[i].w = w;
               intersects[i].h = h;
               return intersects[i];
            }
         }
         */
      },

      onMouseMoveTimeout: function(x, y)
      {
         delete this.mousemove_timeout;

         var intersect = this.getIntersectAt(x,y);

         if (!intersect)
            return this.clearHighlight();

         var c = intersect.object.get_ctrl();

         var mouse = intersect.mouse;

         c.elementHighlighted(c.extractIndex(intersect));

         this.highlighted_scene = c.obj3d.scene;

         if (c.obj3d && c.obj3d.eve_el)
            this.ttip_text.innerHTML = c.getTooltipText(intersect);
         else
            this.ttip_text.innerHTML = "";

         let dome = this.controller.getView().getDomRef();
         let offs = (mouse.x > 0 || mouse.y < 0) ? this.getRelativeOffsets(dome) : null;

         if (mouse.x <= 0) {
            this.ttip.style.left  = (x + dome.offsetLeft + 10) + "px";
            this.ttip.style.right = null;
         } else {
            this.ttip.style.right = (intersect.w - x + offs.right + 10) + "px";
            this.ttip.style.left  = null;
         }
         if (mouse.y >= 0) {
            this.ttip.style.top    = (y + dome.offsetTop + 10) + "px";
            this.ttip.style.bottom = null;
         } else {
            this.ttip.style.bottom = (intersect.h - y + offs.bottom + 10) + "px";
            this.ttip.style.top = null;
         }

         this.ttip.style.display= "block";
      },

      getRelativeOffsets: function(elem)
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
      },

      //------------------------------------------------------------------------------
      // Mouse button handlers, selection, context menu
      //------------------------------------------------------------------------------

      removeMouseupListener: function()
      {
         if (this.mouseup_listener)
         {
            this.get_view().getDomRef().removeEventListener('mouseup', this.mouseup_listener);
            this.mouseup_listener = 0;
         }
      },

      showContextMenu: function(event, menu)
      {
         // console.log("GLC::showContextMenu", this, menu)

         // See js/scripts/JSRootPainter.jquery.js JSROOT.Painter.createMenu(), menu.add()


         var intersect = this.getIntersectAt(event.offsetX, event.offsetY);

         menu.add("header:Context Menu");

         if (intersect) {
            if (intersect.object.eve_el)
               menu.add("Browse to " + (intersect.object.eve_el.fName || "element"), intersect.object.eve_el.fElementId, this.controller.invokeBrowseOf.bind(this.controller));
         }

         menu.add("Reset camera", this.resetThreejsRenderer);

         menu.add("separator");

         let fff = this.defaultContextMenuAction;
         menu.add("sub:Sub Test");
         menu.add("Foo",     'foo', fff);
         menu.add("Bar",     'bar', fff);
         menu.add("Baz",     'baz', fff);
         menu.add("endsub:");

         menu.show(event);
      },

      defaultContextMenuAction: function(arg)
      {
         console.log("GLC::defaultContextMenuAction", this, arg);
      },

      handleMouseSelect: function(event)
      {
         var intersect = this.getIntersectAt(event.offsetX, event.offsetY);

         if (intersect) {
            var c = intersect.object.get_ctrl();
            c.event = event;
            c.elementSelected(c.extractIndex(intersect));
            this.highlighted_scene = intersect.object.scene;
         } else {
            // XXXX HACK - handlersMIR senders should really be in the mgr

            this.controller.created_scenes[0].processElementSelected(null, [], event);
         }
      },

   });

   return GlViewerRCore;
});
