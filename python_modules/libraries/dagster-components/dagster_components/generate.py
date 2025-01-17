import os
from pathlib import Path
from typing import Any, Type

import click
import yaml
from dagster._generate.generate import generate_project
from dagster._utils import camelcase, pushd

from dagster_components.core.component import Component, get_component_name


class ComponentDumper(yaml.Dumper):
    def write_line_break(self) -> None:
        # add an extra line break between top-level keys
        if self.indent == 0:
            super().write_line_break()
        super().write_line_break()


def generate_deployment(path: str) -> None:
    click.echo(f"Creating a Dagster deployment at {path}.")

    generate_project(
        path=path,
        name_placeholder="DEPLOYMENT_NAME_PLACEHOLDER",
        templates_path=os.path.join(
            os.path.dirname(__file__), "templates", "DEPLOYMENT_NAME_PLACEHOLDER"
        ),
    )


def generate_code_location(path: str) -> None:
    click.echo(f"Creating a Dagster code location at {path}.")

    generate_project(
        path=path,
        name_placeholder="CODE_LOCATION_NAME_PLACEHOLDER",
        templates_path=os.path.join(
            os.path.dirname(__file__), "templates", "CODE_LOCATION_NAME_PLACEHOLDER"
        ),
    )


def generate_component_type(root_path: str, name: str) -> None:
    click.echo(f"Creating a Dagster component type at {root_path}/{name}.py.")

    generate_project(
        path=root_path,
        name_placeholder="COMPONENT_TYPE_NAME_PLACEHOLDER",
        templates_path=os.path.join(os.path.dirname(__file__), "templates", "COMPONENT_TYPE"),
        project_name=name,
        component_type_class_name=camelcase(name),
        component_type=name,
    )


def generate_component_instance(
    root_path: str, name: str, component_type: Type[Component], generate_params: Any
) -> None:
    click.echo(f"Creating a Dagster component instance at {root_path}/{name}.py.")

    component_instance_root_path = os.path.join(root_path, name)
    component_registry_key = get_component_name(component_type)
    generate_project(
        path=component_instance_root_path,
        name_placeholder="COMPONENT_INSTANCE_NAME_PLACEHOLDER",
        templates_path=os.path.join(
            os.path.dirname(__file__), "templates", "COMPONENT_INSTANCE_NAME_PLACEHOLDER"
        ),
        project_name=name,
        component_type=component_registry_key,
    )
    with pushd(component_instance_root_path):
        component_params = (
            component_type.generate_files(generate_params)
            if generate_params
            else component_type.generate_files()  # type: ignore
        )
        component_data = {"type": component_registry_key, "params": component_params or {}}
    with open(Path(component_instance_root_path) / "component.yaml", "w") as f:
        yaml.dump(
            component_data, f, Dumper=ComponentDumper, sort_keys=False, default_flow_style=False
        )
