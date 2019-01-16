/// @file EveScene.js

(function( factory ) {
   if ( typeof define === "function" && define.amd ) {
      define( ['JSRootCore'], factory );
   } else if (typeof exports === 'object' && typeof module !== 'undefined') {
      factory(require("./JSRootCore.js"));
   } else {
      if (typeof JSROOT == 'undefined')
        throw new Error('JSROOT is not defined', 'EveScene.js');

      factory(JSROOT);
   }
} (function(JSROOT) {

   "use strict";
   
   console.log("loading EveScene.js");

   /// constructor, handle for REveScene class
   
   function EveScene(mgr,scene,viewer)
   {
      this.mgr = mgr;
      this.scene = scene;
      this.id = scene.fSceneId;
      this.viewer = viewer;
      this.creator = new JSROOT.EVE.EveElements();
      this.creator.useIndexAsIs = (JSROOT.GetUrlOption('useindx') !== null);
      this.id2obj_map = {};
      
      // register ourself for scene events
      this.mgr.RegisterSceneReceiver(scene.fSceneId, this);
   }
   
   EveScene.prototype.hasRenderData = function(elem)
   {
      if (elem===undefined)          
         elem = this.mgr.GetElement(this.id);
      
      if (!elem) return false;
      if (elem.render_data) return true;
      if (elem.childs)
         for (var k = 0; k < elem.childs.length; ++k)
            if (this.hasRenderData(elem.childs[k])) return true;
      return false;
   }
   
   EveScene.prototype.makeGLRepresentation = function(elem)
   {
      if (!elem.render_data) return null;
      var fname = elem.render_data.rnr_func;
      var obj3d = this.creator[fname](elem, elem.render_data);
      if (obj3d)
      {
         obj3d._typename = "THREE.Mesh";

         // SL: this is just identifier for highlight, required to show items on other places, set in creator
         obj3d.geo_object = elem.fMasterId || elem.fElementId;
         obj3d.geo_name = elem.fName; // used for highlight

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
   }
   
   EveScene.prototype.create3DObjects = function(res3d, all_ancestor_children_visible, elem0)
   {
      if (elem0 === undefined)          
         elem0 = this.mgr.GetElement(this.id);

      if (!elem0 || !elem0.childs) return;
      
      for (var k = 0; k < elem0.childs.length; ++k)
      {
         var elem = elem0.childs[k];
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

                  res3d.push(obj3d);
                  
                  this.id2obj_map[elem.fElementId] = obj3d;

                  obj3d.visible = elem.fRnrSelf && all_ancestor_children_visible;
                  obj3d.all_ancestor_children_visible = all_ancestor_children_visible;
               }
            }
         }

         this.create3DObjects(res3d, elem.fRnrChildren && all_ancestor_children_visible, elem);
      }
   } 
   
   /** method insert all objects into three.js container */
   EveScene.prototype.redrawScene = function()
   {
      if (!this.viewer) return;
      
      var res3d = [];
      this.create3DObjects(res3d, true);
      
      var cont = this.viewer.getThreejsContainer("scene" + this.id);
      while (cont.children.length > 0)
         cont.remove(cont.children[0]);
      
      for (var k = 0; k < res3d.length; ++k)
         cont.add(res3d[k]);
      
      this.viewer.render();
   }
   
   EveScene.prototype.getObj3D = function(elementId)
   {
      return this.id2obj_map[elementId];
   }

   EveScene.prototype.update3DObjectsVisibility = function(arr, all_ancestor_children_visible)
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
   }
   
   EveScene.prototype.visibilityChildrenChanged = function(el)
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

         if (this.viewer)
            this.viewer.render();
      }
   }
   
   EveScene.prototype.colorChanged = function(el)
   {
      console.log("color change ", el.fElementId, el.fMainColor);

      this.replaceElement(el);
   }

   EveScene.prototype.replaceElement = function(el)
   {
      if (!this.viewer) return;
      
      var obj3d = this.getObj3D(el.fElementId);
      
      var container = this.viewer.getThreejsContainer("scene" + this.id);

      container.remove(obj3d);

      obj3d = this.makeGLRepresentation(el);

      container.add(obj3d);
      
      this.id2obj_map[el.fElementId] = obj3d;
      
      this.viewer.render();
   }
   
   EveScene.prototype.elementAdded = function(el) {
      if (!this.viewer) return;
      
      var obj3d =  this.makeGLRepresentation(el);
      if (!obj3d) return;
      
      var container = this.viewer.getThreejsContainer("scene" + this.id);

      container.add(obj3d);
      console.log("element added ", el);
      
      this.viewer.render();
   }
   
   EveScene.prototype.visibilityChanged = function(el)
   {
      var obj3d = this.getObj3D( el.fElementId );

      if (obj3d)
      {
         obj3d.visible = obj3d.all_ancestor_children_visible && el.fRnrSelf;
      }

      if (this.viewer)
         this.viewer.render();
   }

   
   EveScene.prototype.elementRemoved = function() {
   }
   
   EveScene.prototype.beginChanges = function() {
   }
   
   EveScene.prototype.endChanges = function() {
   }
   
   EveScene.prototype.onSceneChanged = function(id)
   {
      console.log("scene changed", id);
         
      this.redrawScene();
   }

   JSROOT.EVE.EveScene = EveScene;

   return JSROOT;

}));
