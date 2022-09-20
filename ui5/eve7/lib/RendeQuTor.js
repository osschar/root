import {RenderQueue} from './RC/renderers/RenderQueue.js';
import {RenderPass}  from './RC/renderers/RenderPass.js';
import {CustomShaderMaterial} from './RC/materials/CustomShaderMaterial.js';
import {PickingShaderMaterial} from './RC/materials/PickingShaderMaterial.js';
import {Text2D} from './RC/objects/Text2D.js';
import {IcoSphere} from './RC/objects/IcoSphere.js';

import {FRONT_AND_BACK_SIDE, HIGHPASS_MODE_BRIGHTNESS, HIGHPASS_MODE_DIFFERENCE}
    from './RC/constants.js';
import { Scene } from './RC/RenderCore.js';
// import {} from '';

function iterateSceneR(object, callback)
{
    // if (object === null || object === undefined) return;

    if (object.children.length > 0) {
        for (let i = 0; i < object.children.length; i++) {
            iterateSceneR(object.children[i], callback);
        }
    }

    callback(object);
}

export class RendeQuTor
{
    constructor(renderer, scene, camera)
    {
        this.renderer = renderer;
        this.scene    = scene;
        this.camera   = camera;
        this.queue    = new RenderQueue(renderer);
        this.pqueue   = new RenderQueue(renderer);

        this.make_PRP_plain();
        this.make_PRP_depth2r();

        this.SSAA_value = 1;

        const nearPlane = 0.0625; // XXXX - pass to view_setup(vport, nfclip)
        const farPlane  = 8192;   // XXXX

        // For every pass, store object + resize behaviour
    }

    initDirectToScreen()
    {
        this.make_RP_DirectToScreen();
    }

    initSimple(ssaa_val)
    {
        this.SSAA_value = ssaa_val;

        this.make_RP_SSAA_Super();
        this.make_RP_SSAA_Down();

        this.make_RP_GBuffer();
        this.make_RP_Outline();

        this.make_RP_ToScreen();
        this.RP_ToScreen.input_texture = "color_outline";
        // this.RP_ToScreen.input_texture = "color_ssaa_super";

        this.RP_GBuffer.obj_list = [];
    }

    initFull(ssaa_val)
    {
        this.SSAA_value = ssaa_val;

        this.make_RP_SSAA_Super();
        this.make_RP_HighPassGaussBloom();
        // this.make_RP_SSAA_Down(); this.RP_SSAA_Down.input_texture = "color_bloom";
        this.make_RP_ToScreen();
        this.RP_ToScreen.input_texture = "color_bloom";
    }

    updateViewport(w, h)
    {
        let vp = { width: w, height: h };
        let rq = this.queue._renderQueue;
        for (let i = 0; i < rq.length; i++)
        {
            rq[i].view_setup(vp);
        }
        rq = this.pqueue._renderQueue;
        for (let i = 0; i < rq.length; i++)
        {
            rq[i].view_setup(vp);
        }
    }

    render()
    {
        this.queue.render();
    }

    pick(x, y, detect_depth = false)
    {
        this.renderer.pick_setup(x, y);

        let state = this.pqueue.render();
        state.x = x;
        state.y = y;
        state.depth = -1.0;
        state.object = this.renderer.pickedObject3D;
        // console.log("RenderQuTor::pick", state);

        if (detect_depth && this.renderer.pickedObject3D !== null) {
            let glman  = this.renderer.glManager;
            let gl     = this.renderer.gl;
            let texref = this.pqueue._textureMap["depthr32f_picking"];
            let tex    = glman.getTexture(texref);

            // console.log("Dumper:", glman, gl, texref, tex);

            const fb = gl.createFramebuffer();
			gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
			gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

            let x = this.renderer._pickCoordinateX;
            let y = this.renderer._canvas.height - this.renderer._pickCoordinateY;

            let d = new Float32Array(9);
            gl.readPixels(x-1, y-1, 3, 3, gl.RED, gl.FLOAT, d);

            let near = this.camera.near;
            let far  = this.camera.far;
            for (let i = 0; i < 9; ++i)
                d[i] = (2.0 * near * far) / (far + near - d[i] * (far - near));

            console.log("Pick depth at", x, ",", y, ":", d);

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
            gl.deleteFramebuffer(fb);

            state.depth = d[4];
        }

        return state;
    }

    pick_instance(state) {
        // RCRC Proto-proto-secondary-selection. Requires branch:
        // https://github.com/osschar/RenderCore/tree/img-tex-cache
        if (state.object !== this.renderer.pickedObject3D) {
            console.error("RendeQuTor::pick_instance state mismatch", state, this.renderer.pickedObject3D);
        } else {
            console.log("RenderQuTor::pick going for secondary select");

            this.renderer._pickSecondaryEnabled = true;
            this.pqueue.render();

            state.instance = this.renderer._pickedID;
        }
        return state;
    }


    //=============================================================================
    // Picking RenderPasses
    //=============================================================================

    make_PRP_plain()
    {
        var pthis = this;

        this.PRP_plain = new RenderPass(
            RenderPass.BASIC,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                // pthis.renderer._specialRenderFoo = "Choopacabra";
                return { scene: pthis.scene, camera: pthis.camera };
            },
            function (textureMap, additionalData) {},
            RenderPass.TEXTURE,
            null,
            "depth_picking",
            [ { id: "color_picking", textureConfig: RenderPass.DEFAULT_R32UI_TEXTURE_CONFIG } ]
        );
        this.PRP_plain.view_setup = function (vport) { this.viewport = vport; };

        this.pqueue.pushRenderPass(this.PRP_plain);
    }

    make_PRP_depth2r()
    {
        this.PRP_depth2r_mat = new CustomShaderMaterial("copyDepth2RReve");
        this.PRP_depth2r_mat.lights = false;
        var pthis = this;

        this.PRP_depth2r = new RenderPass(
            RenderPass.POSTPROCESS,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                return { material: pthis.PRP_depth2r_mat, textures: [ textureMap["depth_picking"] ] };
            },
            function (textureMap, additionalData) {},
            RenderPass.TEXTURE,
            null,
            null,
            [ { id: "depthr32f_picking", textureConfig: RenderPass.FULL_FLOAT_R32F_TEXTURE_CONFIG } ]
        );
        this.PRP_depth2r.view_setup = function (vport) { this.viewport = vport; };

        this.pqueue.pushRenderPass(this.PRP_depth2r);
    }


    //=============================================================================
    // Regular RenderPasses
    //=============================================================================

    make_RP_DirectToScreen()
    {
        var pthis = this;

        this.RP_DirectToScreen = new RenderPass(
            RenderPass.BASIC,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) { return { scene: pthis.scene, camera: pthis.camera }; },
            function (textureMap, additionalData) {},
            RenderPass.SCREEN,
            null
        );
        this.RP_DirectToScreen.view_setup = function (vport) { this.viewport = vport; };

        this.queue.pushRenderPass(this.RP_DirectToScreen);
    }

    //=============================================================================

    make_RP_SSAA_Super()
    {
        var pthis = this;

        this.RP_SSAA_Super = new RenderPass(
            // Rendering pass type
            RenderPass.BASIC,
            // Initialize function
            function (textureMap, additionalData) {},
            // Preprocess function
            function (textureMap, additionalData) { return { scene: pthis.scene, camera: pthis.camera }; },
            // Postprocess
            function (textureMap, additionalData) {},
            // Target
            RenderPass.TEXTURE,
            // Viewport
            null,
            // Bind depth texture to this ID
            "depthDefaultSuper",
            // Outputs
            [ { id: "color_ssaa_super", textureConfig: RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG } ]
        );
        this.RP_SSAA_Super.view_setup = function (vport) { this.viewport = { width: vport.width*pthis.SSAA_value, height: vport.height*pthis.SSAA_value }; };

        this.queue.pushRenderPass(this.RP_SSAA_Super);
    }

    make_RP_SSAA_Down()
    {
        this.RP_SSAA_Down_mat = new CustomShaderMaterial("copyTexture");
        this.RP_SSAA_Down_mat.lights = false;
        let pthis = this;

        this.RP_SSAA_Down = new RenderPass(
            // Rendering pass type
            RenderPass.POSTPROCESS,

            // Initialize function
            function (textureMap, additionalData) {},
            // Preprocess function
            function (textureMap, additionalData) {
                return { material: pthis.RP_SSAA_Down_mat, textures: [textureMap[this.input_texture]] };
            },
            // Postprocess function
            function (textureMap, additionalData) {},

            // Target
            RenderPass.TEXTURE,

            // Viewport
            null,

            // Bind depth texture to this ID
            null,

            [ { id: "color_ssaa_down", textureConfig: RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG } ]
        );
        this.RP_SSAA_Down.input_texture = "color_ssaa_super";
        this.RP_SSAA_Down.view_setup = function(vport) { this.viewport = vport; };

        this.queue.pushRenderPass(this.RP_SSAA_Down);
    }

    //=============================================================================

    make_RP_ToScreen()
    {
        this.RP_ToScreen_mat = new CustomShaderMaterial("copyTexture");
        this.RP_ToScreen_mat.lights = false;
        let pthis = this;

        this.RP_ToScreen = new RenderPass(
            RenderPass.POSTPROCESS,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                return { material: pthis.RP_ToScreen_mat, textures: [ textureMap[this.input_texture] ] };
            },
            function (textureMap, additionalData) {},
            RenderPass.SCREEN,
            null
        );
        this.RP_ToScreen.input_texture = "color_ssaa_down";
        this.RP_ToScreen.view_setup = function(vport) { this.viewport = vport; };

        this.queue.pushRenderPass(this.RP_ToScreen);
    }

    //=============================================================================

    make_RP_HighPassGaussBloom()
    {
        var pthis = this;
        // let hp = new CustomShaderMaterial("highPass", {MODE: HIGHPASS_MODE_BRIGHTNESS, targetColor: [0.2126, 0.7152, 0.0722], threshold: 0.75});
        let hp = new CustomShaderMaterial("highPass", { MODE: HIGHPASS_MODE_DIFFERENCE,
                                             targetColor: [0x0/255, 0x0/255, 0xff/255], threshold: 0.1});
        console.log("XXXXXXXX", hp);
        // let hp = new CustomShaderMaterial("highPassReve");
        this.RP_HighPass_mat = hp;
        this.RP_HighPass_mat.lights = false;

        this.RP_HighPass = new RenderPass(
            RenderPass.POSTPROCESS,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                return { material: pthis.RP_HighPass_mat, textures: [textureMap["color_ssaa_super"]] };
            },
            function (textureMap, additionalData) {},
            RenderPass.TEXTURE,
            null,
            // XXXXXX MT: this was "dt", why not null ????
            null, // "dt",
            [ {id: "color_high_pass", textureConfig: RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG} ]
        );
        this.RP_HighPass.view_setup = function (vport) { this.viewport = { width: vport.width*pthis.SSAA_value, height: vport.height*pthis.SSAA_value }; };
        this.queue.pushRenderPass(this.RP_HighPass);

        this.RP_Gauss1_mat = new CustomShaderMaterial("gaussBlur", {horizontal: true, power: 1.0});
        this.RP_Gauss1_mat.lights = false;

        this.RP_Gauss1 = new RenderPass(
            RenderPass.POSTPROCESS,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                return { material: pthis.RP_Gauss1_mat, textures: [textureMap["color_high_pass"]] };
            },
            function (textureMap, additionalData) {},
            RenderPass.TEXTURE,
            null,
            null,
            [ {id: "color_gauss_half", textureConfig: RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG} ]
        );
        this.RP_Gauss1.view_setup = function (vport) { this.viewport = { width: vport.width*pthis.SSAA_value, height: vport.height*pthis.SSAA_value }; };
        this.queue.pushRenderPass(this.RP_Gauss1);

        this.RP_Gauss2_mat = new CustomShaderMaterial("gaussBlur", {horizontal: false, power: 1.0});
        this.RP_Gauss2_mat.lights = false;

        this.RP_Gauss2 = new RenderPass(
            RenderPass.POSTPROCESS,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                return { material: pthis.RP_Gauss2_mat, textures: [textureMap["color_gauss_half"]] };
            },
            function (textureMap, additionalData) {},
            RenderPass.TEXTURE,
            null,
            null,
            [ {id: "color_gauss_full", textureConfig: RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG} ]
        );
        this.RP_Gauss2.view_setup = function (vport) { this.viewport = { width: vport.width*pthis.SSAA_value, height: vport.height*pthis.SSAA_value }; };
        this.queue.pushRenderPass(this.RP_Gauss2);

        this.RP_Bloom_mat = new CustomShaderMaterial("bloom");
        this.RP_Bloom_mat.lights = false;

        this.RP_Bloom = new RenderPass(
            RenderPass.POSTPROCESS,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                return { material: pthis.RP_Bloom_mat, textures: [textureMap["color_gauss_full"], textureMap["color_ssaa_super"]] };
            },
            function (textureMap, additionalData) {},
            RenderPass.TEXTURE,
            null,
            null,
            [ {id: "color_bloom", textureConfig: RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG} ]
        );
        this.RP_Bloom.view_setup = function (vport) { this.viewport = { width: vport.width*pthis.SSAA_value, height: vport.height*pthis.SSAA_value }; };
        this.queue.pushRenderPass(this.RP_Bloom);
    }

    //=============================================================================

    make_RP_GBuffer()
    {
        this.RP_GBuffer_mat = new CustomShaderMaterial("GBufferMini");
        this.RP_GBuffer_mat.lights = false;
        this.RP_GBuffer_mat.side = FRONT_AND_BACK_SIDE;

        let pthis = this;

        this.RP_GBuffer = new RenderPass(
            RenderPass.BASIC,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                pthis.renderer._outlineEnabled = true;
                pthis.renderer._outlineArray = this.obj_list;
                pthis.renderer._defaultOutlineMat = pthis.RP_GBuffer_mat;
                pthis.renderer._fillRequiredPrograms(pthis.RP_GBuffer_mat.requiredProgram(pthis.renderer));
                for (const o3d of this.obj_list) {
                    if (o3d.outlineMaterial)
                        pthis.renderer._fillRequiredPrograms(o3d.outlineMaterial.requiredProgram(pthis.renderer));
                }
                return { scene: pthis.scene, camera: pthis.camera };
            },
            function (textureMap, additionalData) {
                pthis.renderer._outlineEnabled = false; // can remain true if not all progs are loaded
                pthis.renderer._outlineArray = null;
            },
            RenderPass.TEXTURE,
            null,
            "depthDefault",
            [
                {id: "normal",  textureConfig: RenderPass.DEFAULT_RGBA16F_TEXTURE_CONFIG},
                {id: "viewDir", textureConfig: RenderPass.DEFAULT_RGBA16F_TEXTURE_CONFIG}
            ]
        );
        this.RP_GBuffer.view_setup = function (vport) { this.viewport = vport; };

        // TODO: No push, GBuffer/Outline passes should be handled separately as there can be more of them.
        this.queue.pushRenderPass(this.RP_GBuffer);
        return this.RP_GBuffer;
    }

    make_RP_Outline()
    {
        this.RP_Outline_mat = new CustomShaderMaterial("outline",
          { scale: 1.5*Math.E, // Math.E,
            edgeColor: [0.7, 0.1, 0.5, 1.0],
            _DepthThreshold: 6.0,
            _NormalThreshold: 0.6, // 0.4,
            _DepthNormalThreshold: 0.5,
            _DepthNormalThresholdScale: 7.0 });
        this.RP_Outline_mat.lights = false;

        let pthis = this;

        this.RP_Outline = new RenderPass(
            RenderPass.POSTPROCESS,
            function (textureMap, additionalData) {},
            function (textureMap, additionalData) {
                return { material: pthis.RP_Outline_mat,
                         textures: [ textureMap["depthDefault"], textureMap["normal"],
                                     textureMap["viewDir"], textureMap["color_ssaa_down"] ] };
            },
            function (textureMap, additionalData) {},
            RenderPass.TEXTURE,
            null,
            null,
            [
                {id: "color_outline", textureConfig: RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG}
            ]
        );
        this.RP_Outline.view_setup = function (vport) { this.viewport = vport; };

        // TODO: No push, GBuffer/Outline passes should be handled separately as there can be more of them.
        this.queue.pushRenderPass(this.RP_Outline);
        return this.RP_Outline;
    }

}
