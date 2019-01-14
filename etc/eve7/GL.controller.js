sap.ui.define([
   'sap/ui/core/mvc/Controller',
   'sap/ui/model/json/JSONModel',
   "sap/ui/core/ResizeHandler"
], function (Controller, JSONModel, ResizeHandler) {

   "use strict";

   return Controller.extend("eve.GL", {

      onInit : function()
      {
         var id = this.getView().getId();
         console.log("eve.GL.onInit id = ", id);

         var data = this.getView().getViewData();
         // console.log("VIEW DATA", data);

         if (data.standalone && data.conn_handle)
         {
            this.mgr = new JSROOT.EVE.EveManager();
            this.mgr.UseConnection(data.conn_handle);
            this.standalone = data.standalone;
            this.mgr.RegisterUpdate(this, "onManagerUpdate");
         }
         else
         {
            this.mgr = data.mgr;
            this.elementid = data.elementid;
            this.kind = data.kind;
         }

         ResizeHandler.register(this.getView(), this.onResize.bind(this));
         this.fast_event = [];

         this._load_scripts = false;
         this._render_html = false;
         this.geo_painter = null;
         // this.painter_ready = false;

         this.mgr.RegisterHighlight(this, "onElementHighlight");

         JSROOT.AssertPrerequisites("geom;user:evedir/EveElements.js", this.onLoadScripts.bind(this));

         // this.checkScences();


         // MT-HAKA
         this.id2obj_map = {};
         this.scene      = new THREE.Scene();
         this.camera     = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );

         // this.controls = new THREE.OrbitControls( this.camera );
         //var controls = new THREE.FirstPersonControls( camera );

         this.renderer = new THREE.WebGLRenderer();
         this.renderer.setPixelRatio( window.devicePixelRatio );
         this.renderer.setSize( window.innerWidth, window.innerHeight );

         this.scene.fog = new THREE.FogExp2( 0xaaaaaa, 0.05 );
         this.renderer.setClearColor( this.scene.fog.color, 1 );

         this.dom_registered = false;
         //document.body.appendChild( this.renderer.domElement );

         //document.getElementById('EveViewer9').appendChild( this.renderer.domElement );

         // this.getView().getDomRef().appendChild( this.renderer.domElement );

         // -------

         var sphere = new THREE.SphereGeometry( 0.1, 8, 8 );
         // var lamp = new THREE.DirectionalLight( 0xff5050, 0.5 );
         var lampR = new THREE.PointLight( 0xff5050, 0.7 );
         lampR.add(new THREE.Mesh( sphere, new THREE.MeshBasicMaterial( { color: lampR.color } ) ));
         lampR.position.set(2, 2, -2);
         this.scene.add( lampR );

         var lampG = new THREE.PointLight( 0x50ff50, 0.7 );
         lampG.add(new THREE.Mesh( sphere, new THREE.MeshBasicMaterial( { color: lampG.color } ) ));
         lampG.position.set(-2, 2, 2);
         this.scene.add( lampG );

         var lampB = new THREE.PointLight( 0x5050ff, 0.7 );
         lampB.add(new THREE.Mesh( sphere, new THREE.MeshBasicMaterial( { color: lampB.color } ) ));
         lampB.position.set(2, 2, 2);
         this.scene.add( lampB );

         var plane = new THREE.GridHelper(20, 20, 0x80d080, 0x8080d0);
         this.scene.add(plane);

         this.camera.position.set(-6, 6, -6);
         this.camera.lookAt(plane);

         //this.controls.update();
         //this.render();
      },

      // MT-HAKA
      render: function()
      {
         console.log("render");

         if ( ! this.dom_registered)
         {
            this.getView().getDomRef().appendChild( this.renderer.domElement );

            //this.controls = new THREE.OrbitControls( this.camera);
            this.controls = new THREE.OrbitControls( this.camera, this.getView().getDomRef() );

            this.controls.addEventListener( 'change', this.onThreeChange.bind(this) );

            this.dom_registered = true;
         }

         //console.log(this.controls);
         //console.log(this.getView().getDomRef());
         //console.log(this.renderer.domElement);

         // requestAnimationFrame( this.render.bind(this) );

         // this.controls.update( );

         this.renderer.render( this.scene, this.camera );
      },

      onThreeChange: function(etypetarget)
      {
         // console.log("THREE change ", etypetarget, event);

         this.render();
      },

      onLoadScripts: function()
      {
         this._load_scripts = true;
         // only when scripts loaded, one could create objects
         this.creator = new JSROOT.EVE.EveElements();
         this.creator.useIndexAsIs = (JSROOT.GetUrlOption('useindx') !== null);
         this.checkScences();
      },

      onManagerUpdate: function() {
         // called when manager was updated, need only in standalone modes to detect own element id
         if (!this.standalone || this.elementid) return;

         var viewers = this.mgr.FindViewers();

         // first check number of views to create
         var found = null;
         for (var n=0;n<viewers.length;++n) {
            if (viewers[n].fName.indexOf(this.standalone) == 0) { found = viewers[n]; break; }
         }
         if (!found) return;

         this.elementid = found.fElementId;
         this.kind = (found.fName == "Default Viewer") ? "3D" : "2D";
         this.checkScences();

      },

      // function called from GuiPanelController
      onExit: function() {
         if (this.mgr) this.mgr.Unregister(this);
      },

      onElementChanged: function(id, element)
      {
         console.log("onElementChanged -- GRRR apparently still used", id, element);
         throw "GRRR";

         // this.checkScences();
      },

      onAfterRendering: function() {

         this._render_html = true;

         // TODO: should be specified somehow in XML file
         this.getView().$().css("overflow", "hidden").css("width", "100%").css("height", "100%").parent().css("overflow", "hidden");

         this.checkScences();
      },

      checkScences: function() {

         if (!this._load_scripts || !this._render_html || !this.elementid) return;

         if (!this.register_for_change) {
            this.register_for_change = true;

            // only when rendering completed - register for modify events
            var element = this.mgr.GetElement(this.elementid);

            // loop over scene and add dependency
            for (var k=0;k<element.childs.length;++k) {
               var scene = element.childs[k];
               this.mgr.Register(scene.fSceneId, this, "onElementChanged");
            }
         }

         // start drawing only when all scenes has childs
         // this is configured view
         var element   = this.mgr.GetElement(this.elementid),
             allok     = true,
             anyextras = false;

         // loop over scene and add dependency
         for (var k=0;k<element.childs.length;++k)
         {
            var scene_info = element.childs[k];
            if ( ! scene_info) { allok = false; break; }
            var scene = this.mgr.GetElement(scene_info.fSceneId);
            if (this.hasExtras(scene)) anyextras = true;
         }

         if (allok && anyextras) this.drawGeometry();

         this.render();
      },

      drawGeometry: function()
      {
         // console.log("start geometry drawing", this.getView().getId());

 /*           var shape = {
      _typename: "TGeoBBox",
      fUniqueID: 0, fBits: 0x3000000, fName: "BOX", fTitle: "",
      fShapeId: 256, fShapeBits: 1024, fDX: 200, fDY: 300, fDZ: 400, fOrigin: [0,0,0]
      };

      var geom_obj = JSROOT.extend(JSROOT.Create("TEveGeoShapeExtract"),
                      { fTrans: null, fShape: shape, fRGBA: [0, 1, 0, 0.2], fElements: null, fRnrSelf: true });
 */
         var options = "", geom_obj = null;
         if (this.kind != "3D") options = "ortho_camera";

         // if (this.geo_painter) {

         //    // when geo painter alreay exists - clear all our additional objects
         //    this.geo_painter.clearExtras();

         //    this.geo_painter.ResetReady();

         // } else {

         //    // TODO: should be specified somehow in XML file
         //    this.getView().$().css("overflow", "hidden").css("width", "100%").css("height", "100%");

         //    this.geo_painter = JSROOT.Painter.CreateGeoPainter(this.getView().getDomRef(), null, options);
         // }

         // this.painter_ready = false;
         // // assign callback function - when needed
         // this.geo_painter.WhenReady(this.onGeomertyDrawn.bind(this));

         // now loop over all  scene and create three.js objects

         // top scene element
         var element = this.mgr.GetElement(this.elementid);

         // loop over scene and add dependency
         for (var k = 0; k < element.childs.length; ++k)
         {
            var scene_info = element.childs[k];
            if ( ! scene_info) continue;
            var scene = this.mgr.GetElement(scene_info.fSceneId);

            if (scene && scene.childs)
               this.create3DObjects(scene.childs);
         }

         // if geometry detected in the scenes, it will be used to display

         //this.geo_painter.AssignObject(geom_obj);

         //this.geo_painter.prepareObjectDraw(geom_obj); // and now start everything

         // AMT temporary here, should be set in camera instantiation time
         // if (this.geo_painter._camera.type == "OrthographicCamera") {
         //    this.geo_painter._camera.left = -this.getView().$().width();
         //    this.geo_painter._camera.right = this.getView().$().width();
         //    this.geo_painter._camera.top = this.getView().$().height();
         //    this.geo_painter._camera.bottom = -this.getView().$().height();
         //    this.geo_painter._camera.updateProjectionMatrix();
         //    this.geo_painter.Render3D();
         // }
         // JSROOT.draw(this.getView().getDomRef(), obj, "", this.onGeomertyDrawn.bind(this));
      },

      onGeomertyDrawn: function(painter) {
         //this.painter_ready = true;
         //this.geo_painter._highlight_handlers = [ this ]; // register ourself for highlight handling
         this.last_highlight = null;
      },

      /// function called by GeoPainter, when mesh is highlighted
      /// forward message to the EveManager to redistribute event to all other drawings
      HighlightMesh: function(mesh, color, geo_object) {
         if (this.last_highlight === geo_object) return;
         this.last_highlight = geo_object;
         this.mgr.ProcessHighlight(this, geo_object, geo_object ? 0 : 100);
      },

      /// invoked from the manager

      onElementHighlight: function(masterid)
      {
         console.log("onElementHighlight not implemented");
         // if (!this.painter_ready || !this.geo_painter) return;

         // // masterid used as identifier, no any recursions
         // this.geo_painter.HighlightMesh(null, null, masterid, null, true);
      },

      makeGLRepresentation: function(elem)
      {
           if (!elem.render_data) return null;
         var fname = elem.render_data.rnr_func;
         var obj3d = this.creator[fname](elem, elem.render_data);
         if (obj3d)
         {
            obj3d._typename = "THREE.Mesh";

            // SL: this is just identifier for highlight, required to show items on other places, set in creator
            // obj3d.geo_object = elem.fMasterId || elem.fElementId;
            // obj3d.geo_name = elem.fName; // used for highlight

            //AMT: reference needed in MIR callback
            obj3d.eveId = elem.fElementId;

            if (elem.render_data.matrix)
            {
               obj3d.matrixAutoUpdate = false;
               obj3d.matrix.fromArray( elem.render_data.matrix );
               obj3d.updateMatrixWorld(true);
            }
            return obj3d;
         }
      },

      create3DObjects: function(arr, all_ancestor_children_visible)
      {
         if (!arr) return;

         for (var k = 0; k < arr.length; ++k)
         {
            var elem = arr[k];
            if (elem.render_data)
            {
               var fname = elem.render_data.rnr_func, obj3d = null;
               if (!this.creator[fname])
               {
                  console.error("Function " + fname + " missing in creator");
               }
               else
               {
                  var obj3d = this.makeGLRepresentation(elem);
                  if (obj3d)
                  {
                     // MT - should maintain hierarchy ????
                     // Easier to remove ... but might need sub-class of
                     // Object3D to separate "graphical" children and structural children.

                     this.scene.add(obj3d);
                     this.id2obj_map[elem.fElementId] = obj3d;

                     obj3d.visible = elem.fRnrSelf && all_ancestor_children_visible;
                     obj3d.all_ancestor_children_visible = all_ancestor_children_visible;
                  }
               }
            }

            this.create3DObjects(elem.childs, elem.fRnrChildren && all_ancestor_children_visible);
         }
      },

      update3DObjectsVisibility: function(arr, all_ancestor_children_visible)
      {
         if (!arr) return;

         for (var k = 0; k < arr.length; ++k)
         {
            var elem = arr[k];
            if (elem.render_data)
            {
               var obj3d = this.getObj3D(elem.fElementId);
               if (obj3d)
               {
                  obj3d.visible = elem.fRnrSelf && all_ancestor_children_visible;
                  obj3d.all_ancestor_children_visible = all_ancestor_children_visible;
               }
            }

            this.update3DObjectsVisibility(elem.childs, elem.fRnrChildren && all_ancestor_children_visible);
         }
      },

      hasExtras: function(elem)
      {
         if (!elem) return false;
         if (elem.render_data) return true;
         if (elem.childs)
            for (var k = 0; k < elem.childs.length; ++k)
               if (this.hasExtras(elem.childs[k])) return true;
         return false;
      },

      onResize: function(event) {
         // use timeout
         // console.log("resize painter")
         if (this.resize_tmout) clearTimeout(this.resize_tmout);
         this.resize_tmout = setTimeout(this.onResizeTimeout.bind(this), 300); // minimal latency
      },

      onResizeTimeout: function() {
         delete this.resize_tmout;

         // TODO: should be specified somehow in XML file
         this.getView().$().css("overflow", "hidden").css("width", "100%").css("height", "100%");
         if (this.geo_painter)
            this.geo_painter.CheckResize();
      },

      colorChanged: function(el)
      {
         console.log("color change ", el.fElementId, el.fMainColor);

         this.replaceElement(el);
      },

      replaceElement: function(el)
      {
         var obj3d = this.getObj3D(el.fElementId);

         this.scene.remove(obj3d);

         obj3d = this.makeGLRepresentation(el);

         this.scene.add(obj3d);
         this.id2obj_map[el.fElementId] = obj3d;

         this.render();
      },

      getObj3D : function(elementId)
      {
         if (this.id2obj_map[elementId] === undefined)
            return null;
         else
            return this.id2obj_map[elementId];
      },

      visibilityChanged: function(el)
      {
         var obj3d = this.getObj3D( el.fElementId );

         if (obj3d)
         {
            obj3d.visible = obj3d.all_ancestor_children_visible && el.fRnrSelf;
         }

         this.render();
      },

      visibilityChildrenChanged: function(el)
      {
         console.log("visibility children changed ", this.mgr, el);

         if (el.childs)
         {
            // XXXX Overkill, but I don't have obj3d for all elements.
            // Also, can do this traversal once for the whole update package,
            // needs to be managed from EveManager.js.
            // Or marked here and then recomputed before rendering (probably better).

            var scene = this.mgr.GetElement(el.fSceneId);

            this.update3DObjectsVisibility(scene.childs, true);

            this.render();
         }
      },
       elementAdded: function(el) {
         var obj3d =  this.makeGLRepresentation(el);
         if (obj3d) {
            this.geo_painter.addExtra(obj3d);
            this.geo_painter.getExtrasContainer().add(obj3d);
         }
           console.log("element added ", obj3d, el);
         this.geo_painter.Render3D(-1);           
      },
      elementRemoved: function() {
      },
      beginChanges: function() {
      },
      endChanges: function() {
      }
   });

});
