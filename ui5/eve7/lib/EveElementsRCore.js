sap.ui.define(['rootui5/eve7/lib/EveManager'], function (EveManager)
{
   "use strict";

   // See also EveScene.js makeGLRepresentation(), there several members are
   // set for the top-level Object3D.

   //==============================================================================
   // EveElemControl
   //==============================================================================

   class EveElemControl
   {

      constructor(iobj, tobj)
      {
         this.invoke_obj = iobj;
         this.top_obj = tobj ? tobj : iobj;
      }

      invokeSceneMethod(fname, arg, event)
      {
         if ( ! this.top_obj || ! this.top_obj.eve_el) return false;

         let s = this.top_obj.scene;
         if (s && (typeof s[fname] == "function"))
            return s[fname](this.top_obj.eve_el, arg, event);
         return false;
      }

      getTooltipText()
      {
         let el = this.top_obj.eve_el;
         return el.fTitle || el.fName || "";
      }

      extractIndex(instance)
      {
         return instance;
      }

      elementHighlighted(indx, event)
      {
         // default is simple selection, we ignore the indx
         return this.invokeSceneMethod("processElementHighlighted", indx, event);
      }

      elementSelected(indx, event)
      {
         // default is simple selection, we ignore the indx
         return this.invokeSceneMethod("processElementSelected", indx, event);
      }

      DrawForSelection(sec_idcs, res)
      {
         res.geom.push(this.invoke_obj);
      }

   } // class EveElemControl


   class Calo3DControl extends EveElemControl {

      DrawForSelection(sec_idcs, res, extra) {
         console.log("CALO 3d draw for selection ", extra);
         // locate REveCaloData cells for this object
         let cells;
         for (let i = 0; i < extra.length; i++) {
            if (extra[i].caloVizId == this.obj3d.eve_el.fElementId) {
               cells = extra[i].cells;
               break;
            }
         }

         let ibuff = this.obj3d.eve_el.render_data.idxBuff;
         let nbox = ibuff.length / 2;
         let nBoxSelected = parseInt(cells.length);
         let boxIdcs = new Array;
         for (let i = 0; i < cells.length; i++) {
            let tower = cells[i].t;
            let slice = cells[i].s;

            for (let r = 0; r < nbox; r++) {
               if (ibuff[r * 2] == slice && ibuff[r * 2 + 1] == tower) {
                  boxIdcs.push(r);
                  break;
               }
            }
         }
         let rnr_data = this.obj3d.eve_el.render_data;
         let protoIdcs = [0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0, 1, 2, 3, 1, 3, 0, 4, 7, 6, 4, 6, 5];
         let idxBuff = [];
         let vtxBuff = new Float32Array(nbox * 8 * 3);
         for (let i = 0; i < nBoxSelected; ++i) {
            let BoxIdcs = boxIdcs[i];
            for (let c = 0; c < 8; c++) {
               let off = i * 24 + c * 3;
               let pos = BoxIdcs * 24 + c * 3;
               vtxBuff[off] = rnr_data.vtxBuff[pos];
               vtxBuff[off + 1] = rnr_data.vtxBuff[pos + 1];
               vtxBuff[off + 2] = rnr_data.vtxBuff[pos + 2];
            }

            // fix top corners, select can be partial
            for (let c = 0; c < 4; c++) {
               // fix vertex 1
               let pos = BoxIdcs * 24 + c * 3;
               let v1x = rnr_data.vtxBuff[pos];
               let v1y = rnr_data.vtxBuff[pos + 1];
               let v1z = rnr_data.vtxBuff[pos + 2];
               pos += 12;
               let v2x = rnr_data.vtxBuff[pos];
               let v2y = rnr_data.vtxBuff[pos + 1];
               let v2z = rnr_data.vtxBuff[pos + 2];

               let off = i * 24 + 12 + c * 3;
               vtxBuff[off] = v1x + cells[i].f * (v2x - v1x);
               vtxBuff[off + 1] = v1y + cells[i].f * (v2y - v1y);
               vtxBuff[off + 2] = v1z + cells[i].f * (v2z - v1z);
            }

            for (let c = 0; c < 36; c++) {
               let off = i * 8;
               idxBuff.push(protoIdcs[c] + off);
            }
         } // loop boxes

         let body = new RC.Geometry();

         body.indices = new RC.BufferAttribute(idxBuff, 1);
         body.vertices = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         body.computeVertexNormals();
         // ? AMT do we need vertex colors
         let mat = this.RcFancyMaterial(this.ColorBlack, 1.0, { side: RC.FRONT_SIDE });

         let mesh = new RC.Mesh(body, mat);

         res.geom.push(mesh);
      }

      extractIndex(intersect) {
         let idx = Math.floor(intersect.faceIndex / 12);
         return idx;
      }

      elementSelectedSendMIR(idx, selectionId)
      {
         let boxset = this.obj3d.eve_el;
         let scene = this.obj3d.scene;
         let multi = this.event?.ctrlKey ? true : false;

         let boxIdx = idx;

         let fcall = "NewShapePicked(" + boxIdx + ", " + selectionId + ", " + multi + ")"
         scene.mgr.SendMIR(fcall, boxset.fElementId, "ROOT::Experimental::REveDigitSet");
         return true;
      }

      elementSelected(idx)
      {
         return this.elementSelectedSendMIR(idx, this.obj3d.scene.mgr.global_selection_id);
      }

      elementHighlighted(idx)
      {
         return this.elementSelectedSendMIR(idx, this.obj3d.scene.mgr.global_highlight_id);
      }

   } // class Calo3DControl


   class Calo2DControl extends EveElemControl {

      DrawForSelection(sec_idcs, res, extra) {
         let cells;
         for (let i = 0; i < extra.length; i++) {
            if (extra[i].caloVizId == this.obj3d.eve_el.fElementId) {
               cells = extra[i].cells;
               break;
            }
         }

         let ibuff = this.obj3d.eve_el.render_data.idxBuff;
         let vbuff = this.obj3d.eve_el.render_data.vtxBuff;
         let nbox = ibuff.length / 2;
         let nBoxSelected = cells.length;
         let boxIdcs = [];
         for (let i = 0; i < cells.length; i++) {
            let bin = cells[i].b;
            let slice = cells[i].s;
            // let fraction =  cells[i].f;
            for (let r = 0; r < nbox; r++) {
               if (ibuff[r * 2] == slice) {

                  if (bin > 0 && ibuff[r * 2 + 1] == bin) {
                     boxIdcs.push(r);
                     break;
                  } else if (bin < 0 && ibuff[r * 2 + 1] == Math.abs(bin) && vbuff[r * 12 + 1] < 0) {
                     boxIdcs.push(r);
                     break;
                  }
               }
            }
         }
         let idxBuff = [];
         let vtxBuff = new Float32Array(nBoxSelected * 4 * 3);
         let protoIdcs = [0, 1, 2, 2, 3, 0];
         let rnr_data = this.obj3d.eve_el.render_data;
         for (let i = 0; i < nBoxSelected; ++i) {
            let BoxIdcs = boxIdcs[i];
            for (let v = 0; v < 4; v++) {
               let off = i * 12 + v * 3;
               let pos = BoxIdcs * 12 + v * 3;
               vtxBuff[off] = rnr_data.vtxBuff[pos];
               vtxBuff[off + 1] = rnr_data.vtxBuff[pos + 1];
               vtxBuff[off + 2] = rnr_data.vtxBuff[pos + 2];
            }
            {
               // fix vertex 1
               let pos = BoxIdcs * 12;
               let v1x = rnr_data.vtxBuff[pos];
               let v1y = rnr_data.vtxBuff[pos + 1];
               pos += 3;
               let v2x = rnr_data.vtxBuff[pos];
               let v2y = rnr_data.vtxBuff[pos + 1];
               let off = i * 12 + 3;
               vtxBuff[off] = v1x + cells[i].f * (v2x - v1x);
               vtxBuff[off + 1] = v1y + cells[i].f * (v2y - v1y);
            }

            {
               // fix vertex 2
               let pos = BoxIdcs * 12 + 3 * 3;
               let v1x = rnr_data.vtxBuff[pos];
               let v1y = rnr_data.vtxBuff[pos + 1];
               pos -= 3;
               let v2x = rnr_data.vtxBuff[pos];
               let v2y = rnr_data.vtxBuff[pos + 1];
               let off = i * 12 + 3 * 2;
               vtxBuff[off] = v1x + cells[i].f * (v2x - v1x);
               vtxBuff[off + 1] = v1y + cells[i].f * (v2y - v1y);
            }
            for (let c = 0; c < 6; c++) {
               let off = i * 4;
               idxBuff.push(protoIdcs[c] + off);
            }
         }

         let body = new RC.Geometry();
         body.indices = new RC.BufferAttribute(idxBuff, 1);
         body.vertices = new RC.BufferAttribute(rnr_data.vtxBuff, 3);

         let mesh = new THREE.Mesh(body);
         res.geom.push(mesh);
      }

      extractIndex(intersect)
      {
         let idx  = Math.floor(intersect.faceIndex/2);
         return idx;
      }

      elementSelectedSendMIR(idx, selectionId)
      {
          let calo =  this.obj3d.eve_el;
          let idxBuff = calo.render_data.idxBuff;
          let scene = this.obj3d.scene;
          let multi = this.event?.ctrlKey ? true : false;
          let bin = idxBuff[idx*2 + 1];
          let slice =  idxBuff[idx*2];
          // get sign for the case of RhoZ projection
          if (calo.render_data.vtxBuff[idx*12 + 1] < 0) bin = -bin ;

          let fcall = "NewBinPicked(" +  bin + ", " +  slice + ", " + selectionId + ", " + multi + ")"
          scene.mgr.SendMIR(fcall, calo.fElementId, "ROOT::Experimental::REveCalo2D");
          return true;
      }

     elementSelected(idx)
     {
        return this.elementSelectedSendMIR(idx, this.obj3d.scene.mgr.global_selection_id);
     }

     elementHighlighted(idx)
     {
        return this.elementSelectedSendMIR(idx, this.obj3d.scene.mgr.global_highlight_id);
     }

   } // class Calo2Control



   //==============================================================================
   // EveElements
   //==============================================================================

   const GL = { POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4 };
   let RC;

   function RcCol(root_col)
   {
      return new RC.Color(EVE.JSR.getColor(root_col));
   }

   //------------------------------------------------------------------------------
   // Builder functions of this class are called by EveScene to create RCore
   // objects representing an EveElement. They can have children if multiple RCore
   // objects are required (e.g., mesh + lines + points).
   //
   // The top-level object returned by these builder functions will get additional
   // properties injected by EveScene:
   // - eve_el
   // - scene.
   //
   // Object picking functions in GlViewerRCore will navigate up the parent hierarchy
   // until an object with eve_el property is set.
   // If secondary selection is enabled on the eve_el, instance picking will be called
   // as well and the returned ID will be used as the index for secondary selection.
   // This can be overriden by setting get_ctrl property of any RCore object to a function
   // that takes a reference to the said argument and returns an instance of class
   // EveElemControl.
   // get_ctrl property needs to be set at least at the top-level object.

   class EveElements
   {
      constructor(rc, viewer) {
         console.log("EveElements -- RCore");

         RC = rc;
         this.viewer = viewer;

         RC.Cache.enabled = true;

         this.tex_cache = new RC.TextureCache;

         this.POINT_SIZE_FAC = 1;
         this.LINE_WIDTH_FAC = 1;
         this.ColorWhite = new RC.Color(0xFFFFFF);
         this.ColorBlack = new RC.Color(0x000000);
      }

      //----------------------------------------------------------------------------
      // Helper functions
      //----------------------------------------------------------------------------

      GenerateTypeName(obj) { return "RC." + obj.type; }

      SetupPointLineFacs(pf, lf)
      {
         this.POINT_SIZE_FAC = pf;
         this.LINE_WIDTH_FAC = lf;
      }

      UpdatePointPickingMaterial(obj)
      {
         let m = obj.material;
         let p = obj.pickingMaterial;
         p.usePoints = m.usePoints;
         p.pointSize = m.pointSize;
         p.pointsScale = m.pointsScale;
         p.drawCircles = m.drawCircles;
      }

      RcPointMaterial(color, opacity, point_size, props)
      {
         let mat = new RC.PointBasicMaterial;
         mat._color = this.ColorBlack; // color;
         mat._emissive = color;
         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         mat._pointSize = this.POINT_SIZE_FAC;
         if (point_size !== undefined) mat._pointSize *= point_size;
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcLineMaterial(color, opacity, line_width, props)
      {
         let mat = new RC.MeshBasicMaterial; // StripeBasicMaterial
         mat._color = this.ColorBlack;
         mat._emissive = color;
         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         mat._lineWidth = this.LINE_WIDTH_FAC;
         if (line_width !== undefined) mat._lineWidth *= line_width;
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcFlatMaterial(color, opacity, props)
      {
         let mat = new RC.MeshBasicMaterial;
         mat._color = color;
         mat._emissive = color; // mat.emissive.offsetHSL(0, 0.1, 0);
         // Something is strange here. Tried also white (no change) / black (no fill -- ?).
         // mat._emissive = new RC.Color(color);
         // mat.emissive.multiplyScalar(0.1);
         // offsetHSL(0, -0.5, -0.5);

         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcFancyMaterial(color, opacity, props)
      {
         let mat = new RC.MeshPhongMaterial;
         // let mat = new RC.MeshBasicMaterial;

         mat._color = color;
         mat._specular = this.ColorWhite;
         mat._shininess = 32;
   
         if (opacity !== undefined && opacity < 1.0) {
            mat._opacity = opacity;
            mat._transparent = true;
            mat._depthWrite = false;
         }
         if (props !== undefined) {
            mat.update(props);
         }
         return mat;
      }

      RcPickable(el, obj3d, do_children = true, ctrl_class = EveElemControl)
      {
         if (el.fPickable) {
            obj3d.get_ctrl = function(state) { return new ctrl_class(state); }
            obj3d.pickable = true;
            if (do_children) {
               for (let i = 0; i < obj3d.children.length; ++i)
                  obj3d.children[i].pickable = true;
            }
            // using RCore auto-id to get Object3D that got picked.
            return true;
         } else {
            return false;
         }
      }

      TestRnr(name, obj, rnr_data)
      {
         if (obj && rnr_data && rnr_data.vtxBuff) return false;

         let cnt = this[name] || 0;
         if (cnt++ < 5) console.log(name, obj, rnr_data);
         this[name] = cnt;
         return true;
      }

      GetLumAlphaTexture(name, callback)
      {
         let url = window.location.origin + '/rootui5sys/eve7/textures/' + name;

         this.tex_cache.deliver(url,
            callback,
            (image) => {
               return new RC.Texture
                  (image, RC.Texture.ClampToEdgeWrapping, RC.Texture.ClampToEdgeWrapping,
                          RC.Texture.LinearFilter, RC.Texture.LinearFilter,
                          RC.Texture.LUMINANCE_ALPHA, RC.Texture.LUMINANCE_ALPHA, RC.Texture.UNSIGNED_BYTE,
                          image.width, image.height);
            },
            () => { this.viewer.request_render() }
         );
      }

      AddMapToAllMaterials(o3d, tex)
      {
         if (o3d.material) o3d.material.addMap(tex);
         if (o3d.pickingMaterial) o3d.pickingMaterial.addMap(tex);
         if (o3d.outlineMaterial) o3d.outlineMaterial.addMap(tex);
      }

      //----------------------------------------------------------------------------
      // Builder functions
      //----------------------------------------------------------------------------

      //==============================================================================
      // makeHit
      //==============================================================================

      makeHit(hit, rnr_data)
      {
         if (this.TestRnr("hit", hit, rnr_data)) return null;

         let   col   = RcCol(hit.fMarkerColor);
         const msize = this.POINT_SIZE_FAC * hit.fMarkerSize;
         let sm = new RC.ZSpriteBasicMaterial( {
            SpriteMode: RC.SPRITE_SPACE_SCREEN, SpriteSize: [msize, msize],
            color: this.ColorBlack,
            emissive: col,
            diffuse: col.clone().multiplyScalar(0.5) } );
         sm.transparent = true;
         // sm.depthWrite = false;
         // this.GetLumAlphaTexture("star5-32a.png", (tex) => {
         //    sm.addMap(tex);
         // });

         sm.instanceData = new RC.Texture(rnr_data.vtxBuff,
            RC.Texture.ClampToEdgeWrapping, RC.Texture.ClampToEdgeWrapping,
            RC.Texture.NearestFilter, RC.Texture.NearestFilter,
            // RC.Texture.R32F, RC.Texture.R32F, RC.Texture.FLOAT,
            RC.Texture.RGBA32F, RC.Texture.RGBA, RC.Texture.FLOAT,
            hit.fTexX, hit.fTexY);
         sm.instanceData.flipy = false;

         let s = new RC.ZSprite(null, sm);
         s.frustumCulled = false; // need a way to speciy bounding box/sphere !!!
         s.instanced = true;
         s.instanceCount = hit.fSize;

         this.GetLumAlphaTexture("star5-32a.png", this.AddMapToAllMaterials.bind(this, s));

         this.RcPickable(hit, s);

         s.dispose = () => { delete this; } // ??? RCRC instanceData texture ???

         return s;
      }

      //==============================================================================
      // makeTrack
      //==============================================================================

      makeTrack(track, rnr_data)
      {
         if (this.TestRnr("track", track, rnr_data)) return null;

         let N = rnr_data.vtxBuff.length / 3;
         let track_width = 2 * (track.fLineWidth || 1) * this.LINE_WIDTH_FAC;
         let track_color = RcCol(track.fLineColor);

         if (EVE.JSR.browser.isWin) track_width = 1;  // not supported on windows

         let buf = new Float32Array((N - 1) * 6), pos = 0;
         for (let k = 0; k < (N - 1); ++k)
         {
            buf[pos] = rnr_data.vtxBuff[k * 3];
            buf[pos + 1] = rnr_data.vtxBuff[k * 3 + 1];
            buf[pos + 2] = rnr_data.vtxBuff[k * 3 + 2];

            let breakTrack = false;
            if (rnr_data.idxBuff)
               for (let b = 0; b < rnr_data.idxBuff.length; b++)
               {
                  if ((k + 1) == rnr_data.idxBuff[b])
                  {
                     breakTrack = true;
                     break;
                  }
               }

            if (breakTrack)
            {
               buf[pos + 3] = rnr_data.vtxBuff[k * 3];
               buf[pos + 4] = rnr_data.vtxBuff[k * 3 + 1];
               buf[pos + 5] = rnr_data.vtxBuff[k * 3 + 2];
            } else
            {
               buf[pos + 3] = rnr_data.vtxBuff[k * 3 + 3];
               buf[pos + 4] = rnr_data.vtxBuff[k * 3 + 4];
               buf[pos + 5] = rnr_data.vtxBuff[k * 3 + 5];
            }

            pos += 6;
         }

         let style = (track.fLineStyle > 1) ? EVE.JSR.getSvgLineStyle(track.fLineStyle) : "",
            dash = style ? style.split(",") : [],
            lineMaterial;

         if (dash && (dash.length > 1))
         {
            lineMaterial = this.RcLineMaterial(track_color, 1.0, track_width, { dashSize: parseInt(dash[0]), gapSize: parseInt(dash[1]) });
         } else
         {
            lineMaterial = this.RcLineMaterial(track_color, 1.0, track_width);
         }

         let geom = new RC.Geometry();
         geom.vertices = new RC.BufferAttribute(buf, 3);

         let line = new RC.Line(geom, lineMaterial);
         line.renderingPrimitive = RC.LINES;
         line.lineWidth = track_width;

         // required for the dashed material
         //if (dash && (dash.length > 1))
         //   line.computeLineDistances();

         //line.hightlightWidthScale = 2;

         this.RcPickable(track, line);
         line.dispose = function() { /*delete this.geometry; delete this.material;*/ };
         return line;
      }

      //==============================================================================
      // makeJet
      //==============================================================================

      makeJet(jet, rnr_data)
      {
         if (this.TestRnr("jet", jet, rnr_data)) return null;

         // console.log("make jet ", jet);
         // let jet_ro = new RC.Object3D();
         let pos_ba = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         let N = rnr_data.vtxBuff.length / 3;

         let geo_body = new RC.Geometry();
         geo_body.vertices = pos_ba;
         let idcs = new Uint32Array(3 + 3 * (N - 2));
         idcs[0] = 0; idcs[1] = N - 1; idcs[2] = 1;
         for (let i = 1; i < N - 1; ++i)
         {
            idcs[3 * i] = 0; idcs[3 * i + 1] = i; idcs[3 * i + 2] = i + 1;
            // idcs.push( 0, i, i + 1 );
         }
         geo_body.indices = new RC.BufferAttribute(idcs, 1);
         geo_body.computeVertexNormals();

         let geo_rim = new RC.Geometry();
         geo_rim.vertices = pos_ba;
         idcs = new Uint32Array(N - 1);
         for (let i = 1; i < N; ++i) idcs[i - 1] = i;
         geo_rim.indices = new RC.BufferAttribute(idcs, 1);

         let geo_rays = new RC.Geometry();
         geo_rays.vertices = pos_ba;
         idcs = new Uint32Array(2 * (1 + ((N - 1) / 4)));
         let p = 0;
         for (let i = 1; i < N; i += 4)
         {
            idcs[p++] = 0; idcs[p++] = i;
         }
         geo_rays.indices = new RC.BufferAttribute(idcs, 1);

         let mcol = RcCol(jet.fMainColor);
         let lcol = RcCol(jet.fLineColor);

         let mesh = new RC.Mesh(geo_body, this.RcFancyMaterial(mcol, 0.5, { side: RC.FRONT_AND_BACK_SIDE }));

         let line1 = new RC.Line(geo_rim, this.RcLineMaterial(lcol, 0.8, 4));
         line1.renderingPrimitive = RC.LINE_LOOP;

         let line2 = new RC.Line(geo_rays, this.RcLineMaterial(lcol, 0.8, 1));
         line2.renderingPrimitive = RC.LINES;

         mesh.add(line1);
         mesh.add(line2);
         this.RcPickable(jet, mesh);

         mesh.dispose = function() {
            //this.children.forEach(c => { delete c.geometry; delete c.material; });
            //delete this.geometry; delete this.material;
         };

         return mesh;
      }

      makeJetProjected(jet, rnr_data)
      {
         // JetProjected has 3 or 4 points. 0-th is apex, others are rim.
         // Fourth point is only present in RhoZ when jet hits barrel/endcap transition.

         // console.log("makeJetProjected ", jet);

         if (this.TestRnr("jetp", jet, rnr_data)) return null;

         let pos_ba = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         let N = rnr_data.vtxBuff.length / 3;

         let geo_body = new RC.Geometry();
         geo_body.vertices = pos_ba;
         let idcs = new Uint32Array(N > 3 ? 6 : 3);
         idcs[0] = 0; idcs[1] = 1; idcs[2] = 2;
         if (N > 3) { idcs[3] = 0; idcs[4] = 2; idcs[5] = 3; }
         geo_body.indices = new RC.BufferAttribute(idcs, 1);
         geo_body.computeVertexNormals();

         let geo_rim = new RC.Geometry();
         geo_rim.vertices = pos_ba;
         idcs = new Uint32Array(N - 1);
         for (let i = 1; i < N; ++i) idcs[i - 1] = i;
         geo_rim.indices = new RC.BufferAttribute(idcs, 1);

         let geo_rays = new RC.Geometry();
         geo_rays.vertices = pos_ba;
         idcs = new Uint32Array(4); // [ 0, 1, 0, N-1 ];
         idcs[0] = 0; idcs[1] = 1; idcs[2] = 0; idcs[3] = N - 1;
         geo_rays.indices = new RC.BufferAttribute(idcs, 1);;

         let fcol = RcCol(jet.fFillColor);
         let lcol = RcCol(jet.fLineColor);
         // Process transparency !!!
         // console.log("cols", fcol, lcol);

         // double-side material required for correct tracing of colors - otherwise points sequence should be changed
         let mesh = new RC.Mesh(geo_body, this.RcFlatMaterial(fcol, 0.5));

         let line1 = new RC.Line(geo_rim, this.RcLineMaterial(lcol, 0.8, 2));

         let line2 = new RC.Line(geo_rays, this.RcLineMaterial(lcol, 0.8, 0.5));
         line2.renderingPrimitive = RC.LINES;

         mesh.add(line1);
         mesh.add(line2);
         this.RcPickable(jet, mesh);

         mesh.dispose = function() {
            //this.children.forEach(c => { delete c.geometry; delete c.material; });
            //delete this.geometry; delete this.material;
         };
   
         return mesh;
      }

      //==============================================================================
      // make Calorimeters
      //==============================================================================

      makeCalo3D(calo3D, rnr_data)
      {
         let body = new RC.Geometry();
         if (rnr_data.vtxBuff) {
            let vBuff = rnr_data.vtxBuff;
            let protoSize = 6 * 2 * 3;
            let protoIdcs = [0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0, 1, 2, 3, 1, 3, 0, 4, 7, 6, 4, 6, 5];
            let nBox = vBuff.length / 24;
            let idxBuff = new Uint32Array(nBox * protoSize);
            let p = 0;
            for (let i = 0; i < nBox; ++i) {
               for (let c = 0; c < protoSize; c++) {
                  let off = i * 8;
                  idxBuff[p++] = protoIdcs[c] + off;
               }
            }

            body.indices = new RC.BufferAttribute(idxBuff, 1);
            body.vertices = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
            body.computeVertexNormals();

            let ci = rnr_data.idxBuff;
            let off = 0
            let colBuff = new Float32Array(nBox*8*4);
            for (let x = 0; x < nBox; ++x) {
               let slice = ci[x * 2];
               let sliceColor = calo3D.sliceColors[slice];
               let tc = new RC.Color(EVE.JSR.getColor(sliceColor));
               for (let i = 0; i < 8; ++i) {
                  colBuff[off] = tc.r;
                  colBuff[off + 1] = tc.g;
                  colBuff[off + 2] = tc.b;
                  colBuff[off + 3] = 1.0;
                  off += 4;
               }
            }
            body.vertColor = new RC.BufferAttribute(colBuff, 4);
         }

         let mat = this.RcFancyMaterial(this.ColorBlack, 1.0, { side: RC.FRONT_SIDE });
         //let mat = this.RcFlatMaterial(this.ColorBlack, 1.0, { side: RC.FRONT_SIDE });

         mat.useVertexColors = true;
         let mesh = new RC.Mesh(body, mat);

         this.RcPickable(calo3D, mesh);

         // mesh.get_ctrl = function () { return new Calo3DControl(mesh); };
         mesh.dispose = function () { this.geometry.dispose(); this.material.dispose(); };

         return mesh;
      }

      makeCalo2D(calo2D, rnrData)
      {
         let body = new RC.Geometry();
         if (rnrData.vtxBuff) {
            let nSquares = rnrData.vtxBuff.length / 12;
            let nTriang = 2 * nSquares;

            let idxBuff = new Uint32Array(nTriang * 3);
            for (let s = 0; s < nSquares; ++s) {
               let boff = s * 6;
               let ioff = s * 4;

               // first triangle
               idxBuff[boff] = ioff;
               idxBuff[boff + 1] = ioff + 1;
               idxBuff[boff + 2] = ioff + 2;

               // second triangle
               idxBuff[boff + 3] = ioff + 2;
               idxBuff[boff + 4] = ioff + 3;
               idxBuff[boff + 5] = ioff;
            }

            body.indices = new RC.BufferAttribute(idxBuff, 1);
            body.vertices = new RC.BufferAttribute(rnrData.vtxBuff, 3);
            body.computeVertexNormals();

            let ci = rnrData.idxBuff;
            let colBuff = new Float32Array(nSquares * 4 * 4);
            let off = 0;
            for (let x = 0; x < nSquares; ++x) {
               let slice = ci[x * 2];
               let sliceColor = calo2D.sliceColors[slice];
               let tc = new THREE.Color(EVE.JSR.getColor(sliceColor));
               console.log()
               for (let i = 0; i < 4; ++i) {
                  colBuff[off] = tc.r;
                  colBuff[off + 1] = tc.g;
                  colBuff[off + 2] = tc.b;
                  colBuff[off + 3] = 1.0;
                  off += 4;
               }
            }
            body.vertColor = new RC.BufferAttribute(colBuff, 4);
         }


         let mat = this.RcFlatMaterial(this.ColorBlack,0.5);
         mat.useVertexColors = true;
         let mesh = new RC.Mesh(body, mat);

         this.RcPickable(calo2D, mesh);
         //mesh.get_ctrl = function () { return new Calo2DControl(mesh); };
         mesh.dispose = function () { this.geometry.dispose(); this.material.dispose(); };

         return mesh;
      }

      //==============================================================================
      // makeEveGeometry / makeEveGeoShape
      //==============================================================================

      makeEveGeometry(rnr_data)
      {
         let nVert = rnr_data.idxBuff[1] * 3;

         if (rnr_data.idxBuff[0] != GL.TRIANGLES) throw "Expect triangles first.";
         if (2 + nVert != rnr_data.idxBuff.length) throw "Expect single list of triangles in index buffer.";

         let geo = new RC.Geometry();
         geo.vertices = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         geo.indices = new RC.BufferAttribute(rnr_data.idxBuff, 1);
         geo.setDrawRange(2, nVert);
         geo.computeVertexNormalsIdxRange(2, nVert);

         // XXXX Fix this. It seems we could have flat shading with usage of simple shaders.
         // XXXX Also, we could do edge detect on the server for outlines.
         // XXXX a) 3d objects - angle between triangles >= 85 degrees (or something);
         // XXXX b) 2d objects - segment only has one triangle.
         // XXXX Somewhat orthogonal - when we do tesselation, conversion from quads to
         // XXXX triangles is trivial, we could do it before invoking the big guns (if they are even needed).
         // XXXX Oh, and once triangulated, we really don't need to store 3 as number of verts in a poly each time.
         // XXXX Or do we? We might need it for projection stuff.

         return geo;
      }

      makeEveGeoShape(egs, rnr_data)
      {
         let geom = this.makeEveGeometry(rnr_data);

         let fcol = RcCol(egs.fFillColor);

         let material = this.RcFancyMaterial(fcol, 0.2);
         material.side = RC.FRONT_AND_BACK_SIDE;
         material.specular = new RC.Color(1, 1, 1);
         material.shininess = 50;

         let mesh = new RC.Mesh(geom, material);
         this.RcPickable(egs, mesh);
         return mesh;
      }


      //==============================================================================
      // makePolygonSetProjected
      //==============================================================================

      makePolygonSetProjected(psp, rnr_data)
      {
         let psp_ro = new RC.Group();
         let pos_ba = new RC.BufferAttribute(rnr_data.vtxBuff, 3);
         let idx_ba = new RC.BufferAttribute(rnr_data.idxBuff, 1);

         let ib_len = rnr_data.idxBuff.length;

         let fcol = RcCol(psp.fMainColor);

         let material = this.RcFlatMaterial(fcol, 0.4);
         material.side = RC.FRONT_AND_BACK_SIDE;

         let line_mat = this.RcLineMaterial(fcol);

         for (let ib_pos = 0; ib_pos < ib_len;)
         {
            if (rnr_data.idxBuff[ib_pos] == GL.TRIANGLES)
            {
               let geo = new RC.Geometry();
               geo.vertices = pos_ba;
               geo.indices = idx_ba;
               geo.setDrawRange(ib_pos + 2, 3 * rnr_data.idxBuff[ib_pos + 1]);
               geo.computeVertexNormalsIdxRange(ib_pos + 2, 3 * rnr_data.idxBuff[ib_pos + 1]);

               let mesh = new RC.Mesh(geo, material);
               this.RcPickable(psp, mesh);
               psp_ro.add(mesh);

               ib_pos += 2 + 3 * rnr_data.idxBuff[ib_pos + 1];
            }
            else if (rnr_data.idxBuff[ib_pos] == GL.LINE_LOOP)
            {
               let geo = new RC.Geometry();
               geo.vertices = pos_ba;
               geo.indices = idx_ba;
               geo.setDrawRange(ib_pos + 2, rnr_data.idxBuff[ib_pos + 1]);

               let ll = new RC.Line(geo, line_mat);
               ll.renderingPrimitive = RC.LINE_LOOP;
               psp_ro.add(ll);

               ib_pos += 2 + rnr_data.idxBuff[ib_pos + 1];
            }
            else
            {
               console.error("Unexpected primitive type " + rnr_data.idxBuff[ib_pos]);
               break;
            }

         }
         this.RcPickable(psp, psp_ro);

         return psp_ro;
      }

      //==============================================================================

      makeStraightLineSet(el, rnr_data)
      {
         console.log("makeStraightLineSet ...");

         let obj3d = new RC.Group();

         let buf = new Float32Array(el.fLinePlexSize * 6);
         for (let i = 0; i < el.fLinePlexSize * 6; ++i)
         {
            buf[i] = rnr_data.vtxBuff[i];
         }

         let line_mat = this.RcLineMaterial(RcCol(el.fMainColor));

         let geom = new RC.Geometry();
         geom.vertices = new RC.BufferAttribute(buf, 3);

         let line = new RC.Line(geom, line_mat);
         line.renderingPrimitive = RC.LINES;

         this.RcPickable(el, line);
         obj3d.add(line);

         // ---------------- DUH, could share buffer attribute. XXXXX

         let msize = el.fMarkerPlexSize;

         let p_buf = new Float32Array(msize * 3);

         let startIdx = el.fLinePlexSize * 6;
         let endIdx = startIdx + msize * 3;
         for (let i = startIdx; i < endIdx; ++i)
         {
            p_buf[i] = rnr_data.vtxBuff[i];
         }

         let p_geom = new RC.Geometry();
         p_geom.vertices = new RC.BufferAttribute(p_buf, 3);

         let p_mat = this.RcPointMaterial(RcCol(el.fMarkerColor), 1, el.fMarkerSize);
         p_mat.pointsScale = false;
         p_mat.drawCircles = true;

         let marker = new RC.Point({ geometry: p_geom, material: p_mat });
         this.UpdatePointPickingMaterial(marker);
         this.RcPickable(el, marker);
         obj3d.add(marker);

         // For secondary selection, see EveElements.js
         obj3d.eve_idx_buf = rnr_data.idxBuff;

         /*
         let octrl;
         if (el.fSecondarySelect)
            octrl = new StraightLineSetControl(obj3d);
         else
            octrl = new EveElemControl(obj3d);

         line.get_ctrl   = function() { return octrl; };
         marker.get_ctrl = function() { return octrl; };
         obj3d.get_ctrl  = function() { return octrl; };
         */

         return obj3d;
      }

   } // class EveElements

   //==============================================================================

   EVE.EveElements = EveElements;

   return EveElements;
});
