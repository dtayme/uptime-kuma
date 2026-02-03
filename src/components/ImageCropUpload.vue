<template>
    <teleport to="body">
        <div v-if="modelValue" class="image-crop-upload">
            <div class="image-crop-backdrop" @click="close"></div>
            <div class="image-crop-dialog">
                <div class="image-crop-header">
                    <span>Logo</span>
                    <button class="image-crop-close" type="button" @click="close">&times;</button>
                </div>

                <div class="image-crop-body">
                    <input ref="fileInput" class="form-control" type="file" accept="image/*" @change="onFileChange" />

                    <div v-if="imageSrc" class="image-crop-preview">
                        <div
                            ref="viewport"
                            class="image-crop-viewport"
                            @pointerdown="startDrag"
                            @pointermove="onDrag"
                            @pointerup="endDrag"
                            @pointercancel="endDrag"
                            @pointerleave="endDrag"
                        >
                            <img
                                ref="previewImage"
                                :src="imageSrc"
                                :style="previewStyle"
                                class="image-crop-image"
                                draggable="false"
                                @load="onImageLoad"
                            />
                        </div>
                    </div>

                    <div v-if="imageSrc" class="image-crop-controls">
                        <label class="form-label">Zoom</label>
                        <input
                            v-model.number="zoom"
                            class="form-range"
                            type="range"
                            min="1"
                            max="3"
                            step="0.01"
                            @input="updateScale"
                        />
                    </div>
                </div>

                <div class="image-crop-footer">
                    <button type="button" class="btn btn-normal me-2" @click="close">
                        {{ $t("Cancel") }}
                    </button>
                    <button type="button" class="btn btn-primary" :disabled="!imageSrc" @click="applyCrop">
                        {{ $t("Save") }}
                    </button>
                </div>
            </div>
        </div>
    </teleport>
</template>

<script>
export default {
    name: "ImageCropUpload",
    props: {
        modelValue: {
            type: Boolean,
            default: false,
        },
        width: {
            type: Number,
            default: 128,
        },
        height: {
            type: Number,
            default: 128,
        },
        imgFormat: {
            type: String,
            default: "png",
        },
        langType: {
            type: String,
            default: "en",
        },
        field: {
            type: String,
            default: "img",
        },
        noCircle: {
            type: Boolean,
            default: true,
        },
        noSquare: {
            type: Boolean,
            default: false,
        },
    },
    emits: ["update:modelValue", "crop-success"],
    data() {
        return {
            imageSrc: null,
            naturalWidth: 0,
            naturalHeight: 0,
            baseScale: 1,
            scale: 1,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            isDragging: false,
            dragStartX: 0,
            dragStartY: 0,
            dragOffsetX: 0,
            dragOffsetY: 0,
        };
    },
    computed: {
        viewportSize() {
            return Math.max(this.width, this.height) * 2;
        },
        previewStyle() {
            return {
                transform: `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`,
            };
        },
    },
    watch: {
        modelValue(value) {
            if (value) {
                this.resetState();
            }
        },
    },
    methods: {
        close() {
            this.$emit("update:modelValue", false);
        },
        resetState() {
            this.imageSrc = null;
            this.naturalWidth = 0;
            this.naturalHeight = 0;
            this.baseScale = 1;
            this.scale = 1;
            this.zoom = 1;
            this.offsetX = 0;
            this.offsetY = 0;
            this.isDragging = false;
            if (this.$refs.fileInput) {
                this.$refs.fileInput.value = "";
            }
        },
        onFileChange(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                return;
            }

            const reader = new FileReader();
            reader.onload = () => {
                this.imageSrc = reader.result;
            };
            reader.readAsDataURL(file);
        },
        onImageLoad(event) {
            const img = event.target;
            this.naturalWidth = img.naturalWidth;
            this.naturalHeight = img.naturalHeight;
            this.setupScale();
        },
        setupScale() {
            if (!this.naturalWidth || !this.naturalHeight) {
                return;
            }

            const view = this.viewportSize;
            this.baseScale = Math.max(view / this.naturalWidth, view / this.naturalHeight);
            this.zoom = 1;
            this.scale = this.baseScale;

            const scaledWidth = this.naturalWidth * this.scale;
            const scaledHeight = this.naturalHeight * this.scale;
            this.offsetX = (view - scaledWidth) / 2;
            this.offsetY = (view - scaledHeight) / 2;
        },
        updateScale() {
            const view = this.viewportSize;
            const prevScale = this.scale;
            const centerX = (-this.offsetX + view / 2) / prevScale;
            const centerY = (-this.offsetY + view / 2) / prevScale;

            this.scale = this.baseScale * this.zoom;
            this.offsetX = -(centerX * this.scale - view / 2);
            this.offsetY = -(centerY * this.scale - view / 2);
            this.clampOffsets();
        },
        startDrag(event) {
            if (!this.imageSrc) {
                return;
            }
            this.isDragging = true;
            this.dragStartX = event.clientX;
            this.dragStartY = event.clientY;
            this.dragOffsetX = this.offsetX;
            this.dragOffsetY = this.offsetY;
            event.target.setPointerCapture(event.pointerId);
        },
        onDrag(event) {
            if (!this.isDragging) {
                return;
            }

            const deltaX = event.clientX - this.dragStartX;
            const deltaY = event.clientY - this.dragStartY;
            this.offsetX = this.dragOffsetX + deltaX;
            this.offsetY = this.dragOffsetY + deltaY;
            this.clampOffsets();
        },
        endDrag(event) {
            if (!this.isDragging) {
                return;
            }
            this.isDragging = false;
            event.target.releasePointerCapture(event.pointerId);
        },
        clampOffsets() {
            const view = this.viewportSize;
            const scaledWidth = this.naturalWidth * this.scale;
            const scaledHeight = this.naturalHeight * this.scale;

            if (scaledWidth <= view) {
                this.offsetX = (view - scaledWidth) / 2;
            } else {
                const minX = view - scaledWidth;
                this.offsetX = Math.min(0, Math.max(minX, this.offsetX));
            }

            if (scaledHeight <= view) {
                this.offsetY = (view - scaledHeight) / 2;
            } else {
                const minY = view - scaledHeight;
                this.offsetY = Math.min(0, Math.max(minY, this.offsetY));
            }
        },
        applyCrop() {
            const img = this.$refs.previewImage;
            if (!img) {
                return;
            }

            const view = this.viewportSize;
            const canvas = document.createElement("canvas");
            canvas.width = this.width;
            canvas.height = this.height;

            const sx = -this.offsetX / this.scale;
            const sy = -this.offsetY / this.scale;
            const sWidth = view / this.scale;
            const sHeight = view / this.scale;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, this.width, this.height);

            const format = this.imgFormat.toLowerCase() === "jpg" ? "jpeg" : this.imgFormat.toLowerCase();
            const dataUrl = canvas.toDataURL(`image/${format}`);
            this.$emit("crop-success", dataUrl);
            this.close();
        },
    },
};
</script>

<style scoped>
.image-crop-upload {
    position: fixed;
    inset: 0;
    z-index: 9999;
}

.image-crop-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
}

.image-crop-dialog {
    position: relative;
    max-width: 460px;
    margin: 10vh auto;
    background: white;
    border-radius: 12px;
    box-shadow: 0 15px 70px rgba(0, 0, 0, 0.2);
    z-index: 1;
    display: flex;
    flex-direction: column;
}

.image-crop-header,
.image-crop-footer {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #e6e6e6;
}

.image-crop-footer {
    border-top: 1px solid #e6e6e6;
    border-bottom: none;
    justify-content: flex-end;
}

.image-crop-close {
    background: transparent;
    border: none;
    font-size: 20px;
    cursor: pointer;
}

.image-crop-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.image-crop-preview {
    display: flex;
    justify-content: center;
}

.image-crop-viewport {
    width: 256px;
    height: 256px;
    border-radius: 12px;
    overflow: hidden;
    background: #f5f5f5;
    position: relative;
    touch-action: none;
}

.image-crop-image {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    user-select: none;
    pointer-events: none;
}

.image-crop-controls {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.dark .image-crop-dialog {
    background: #0d1117;
    color: #c9d1d9;
}

.dark .image-crop-header,
.dark .image-crop-footer {
    border-color: #30363d;
}

.dark .image-crop-viewport {
    background: #161b22;
}
</style>
